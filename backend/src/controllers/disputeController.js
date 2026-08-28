import {
  Dispute,
  Condition,
  Evidence,
  Payment,
  PromiseModel,
  DISPUTE_STATUS,
  AUDIT_ACTION,
  NOTIFICATION_TYPE,
  PROMISE_STATUS,
  CLOSED_PROMISE_STATUS,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from '../services/auditService.js';
import { notify, stakeholderIds } from '../services/notificationService.js';
import { analyseDispute, recalculatePromise } from '../services/proofEngine.js';
import * as paymentService from '../services/paymentService.js';
import * as payoutService from '../services/payoutService.js';
import { loadPromiseForUser, isPayer } from './helpers.js';

export const listDisputes = asyncHandler(async (req, res) => {
  const visible = await PromiseModel.find(PromiseModel.visibilityFilter(req.user)).select('_id').lean();
  const disputes = await Dispute.find({ promise: { $in: visible.map((row) => row._id) } })
    .sort({ createdAt: -1 })
    .populate('promise', 'title publicId amount currency status')
    .populate('raisedBy', 'name avatar')
    .lean();
  res.json({ success: true, data: { disputes } });
});

export const getDispute = asyncHandler(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id)
    .populate('promise', 'title publicId amount currency status proofConfidence promiseHealth')
    .populate('raisedBy', 'name avatar email')
    .populate('contestedConditions', 'label description status confidence');
  if (!dispute) throw ApiError.notFound('That contest no longer exists.');

  const promise = await loadPromiseForUser(dispute.promise._id, req.user);
  const evidence = await Evidence.find({ promise: promise._id })
    .sort({ createdAt: -1 })
    .populate('submittedBy', 'name avatar')
    .lean();

  res.json({
    success: true,
    data: { dispute, evidence, permissions: { canResolve: isPayer(promise, req.user) } },
  });
});

/** Opening a contest freezes the money: the promise moves to CONTESTED. */
export const createDispute = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.body.promiseId, req.user);
  if (CLOSED_PROMISE_STATUS.includes(promise.status)) {
    throw ApiError.conflict('This promise is closed and can no longer be contested.');
  }

  const open = await Dispute.findOne({
    promise: promise._id,
    status: { $in: [DISPUTE_STATUS.OPEN, DISPUTE_STATUS.UNDER_REVIEW] },
  });
  if (open) throw ApiError.conflict('This promise is already contested.');

  const conditions = req.body.conditionIds.length
    ? await Condition.find({ _id: { $in: req.body.conditionIds }, promise: promise._id })
    : [];

  const dispute = await Dispute.create({
    promise: promise._id,
    raisedBy: req.user._id,
    reason: req.body.reason,
    contestedConditions: conditions.map((condition) => condition._id),
    status: DISPUTE_STATUS.OPEN,
    claims: req.body.statement
      ? [{ user: req.user._id, name: req.user.name, statement: req.body.statement }]
      : [],
  });

  for (const condition of conditions) {
    condition.status = 'CONTESTED';
    await condition.save();
  }

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.DISPUTE_OPENED,
    summary: `Contest opened — ${req.body.reason.slice(0, 90)}`,
    entity: { type: 'Dispute', id: dispute._id },
    metadata: { conditions: conditions.length },
    ip: req.ip,
  });
  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.PROMISE_CONTESTED,
    summary: 'Promise contested — money stays conditional',
  });
  await notify({
    users: stakeholderIds(promise),
    promise,
    type: NOTIFICATION_TYPE.PROMISE_CONTESTED,
    title: 'Promise contested',
    body: `${req.user.name} contested ${promise.title}.`,
    severity: 'critical',
  });

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'contested' });
  res.status(201).json({ success: true, data: { dispute, promise: result.promise } });
});

export const addDisputeClaim = asyncHandler(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id);
  if (!dispute) throw ApiError.notFound('That contest no longer exists.');
  const promise = await loadPromiseForUser(dispute.promise, req.user);
  if (dispute.status === DISPUTE_STATUS.RESOLVED) {
    throw ApiError.conflict('This contest is already resolved.');
  }

  const evidenceIds = req.body.evidenceIds.length
    ? (await Evidence.find({ _id: { $in: req.body.evidenceIds }, promise: promise._id }).select('_id')).map(
        (item) => item._id
      )
    : [];

  dispute.claims.push({
    user: req.user._id,
    name: req.user.name,
    statement: req.body.statement,
    evidence: evidenceIds,
  });
  dispute.status = DISPUTE_STATUS.UNDER_REVIEW;
  await dispute.save();

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.DISPUTE_EVIDENCE_ADDED,
    summary: `${req.user.name} filed a statement in the contest`,
    entity: { type: 'Dispute', id: dispute._id },
    ip: req.ip,
  });

  res.status(201).json({ success: true, data: { dispute } });
});

/** Asks the Proof Engine to read the whole record and say what it supports. */
export const analyseDisputeCase = asyncHandler(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id);
  if (!dispute) throw ApiError.notFound('That contest no longer exists.');
  const promise = await loadPromiseForUser(dispute.promise, req.user);

  const [conditions, evidence] = await Promise.all([
    Condition.find({ promise: promise._id }).sort({ order: 1 }).lean(),
    Evidence.find({ promise: promise._id }).sort({ createdAt: 1 }).lean(),
  ]);

  const result = await analyseDispute({
    promise,
    conditions,
    evidence,
    claims: dispute.claims,
    reason: dispute.reason,
    dispute,
    user: req.user,
  });

  dispute.analysis = {
    ...result.data,
    analysedAt: new Date(),
    engine: result.engine,
  };
  dispute.status = DISPUTE_STATUS.UNDER_REVIEW;
  await dispute.save();

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.DISPUTE_ANALYSED,
    summary: `Proof Engine read the contest — recommends ${result.data.recommendedOutcome.replace(/_/g, ' ')}`,
    entity: { type: 'Dispute', id: dispute._id },
    metadata: { engine: result.engine, confidence: result.data.confidence },
  });

  res.json({ success: true, data: { dispute, analysis: { ...result.data, engine: result.engine } } });
});

/**
 * Resolution is a person's decision. Where it moves money it goes through the
 * payment service, and the promise is recalculated from the resulting records.
 */
export const resolveDispute = asyncHandler(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id);
  if (!dispute) throw ApiError.notFound('That contest no longer exists.');
  const promise = await loadPromiseForUser(dispute.promise, req.user);

  const raisedByMe = String(dispute.raisedBy) === String(req.user._id);
  if (req.body.outcome === 'withdrawn' ? !raisedByMe : !isPayer(promise, req.user)) {
    throw ApiError.forbidden(
      req.body.outcome === 'withdrawn'
        ? 'Only the person who opened this contest can withdraw it.'
        : 'Only the payer can resolve this contest.'
    );
  }
  if (dispute.status === DISPUTE_STATUS.RESOLVED) {
    throw ApiError.conflict('This contest is already resolved.');
  }

  const payment = await Payment.findOne({ promise: promise._id }).sort({ createdAt: -1 });

  if (req.body.outcome === 'released' && payment) {
    const released = await paymentService.releasePayment({ payment, authorisedBy: req.user });
    // A contest resolved by release goes down the same last mile as any other:
    // it decides the money is owed, not that it has arrived.
    released.payout = await payoutService.sendPayout({ payment: released, promise });
    await released.save();

    const settled = payoutService.payoutSettled(released.payout);
    promise.status = settled ? PROMISE_STATUS.FULFILLED : PROMISE_STATUS.SETTLING;
    if (settled) promise.fulfilledAt = new Date();
    await promise.save();
    await recordAudit({
      user: req.user,
      promise,
      action: AUDIT_ACTION.PAYMENT_RELEASED,
      summary: `Contest resolved by release — ${payment.amount} ${payment.currency} to ${promise.recipient.name}`,
      ip: req.ip,
    });
  } else if (req.body.outcome === 'refunded' && payment) {
    await paymentService.refundPayment({ payment, authorisedBy: req.user, reason: req.body.note });
    promise.status = PROMISE_STATUS.CANCELLED;
    promise.cancelledAt = new Date();
    await promise.save();
    await recordAudit({
      user: req.user,
      promise,
      action: AUDIT_ACTION.PAYMENT_REFUNDED,
      summary: `Contest resolved by refund — ${payment.amount} ${payment.currency} returned`,
      ip: req.ip,
    });
  }

  dispute.status = req.body.outcome === 'withdrawn' ? DISPUTE_STATUS.WITHDRAWN : DISPUTE_STATUS.RESOLVED;
  dispute.resolution = {
    outcome: req.body.outcome,
    note: req.body.note,
    resolvedBy: req.user._id,
    resolvedAt: new Date(),
  };
  await dispute.save();

  // Conditions frozen by the contest go back to being derived from their proof.
  await Condition.updateMany(
    { promise: promise._id, status: 'CONTESTED' },
    { $set: { status: 'PENDING', confidence: 0 } }
  );

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.DISPUTE_RESOLVED,
    summary: `Contest resolved — ${req.body.outcome.replace(/_/g, ' ')}`,
    entity: { type: 'Dispute', id: dispute._id },
    metadata: { note: req.body.note },
    ip: req.ip,
  });
  await notify({
    users: stakeholderIds(promise),
    promise,
    type: NOTIFICATION_TYPE.DISPUTE_RESOLVED,
    title: 'Contest resolved',
    body: `${promise.title} — ${req.body.outcome.replace(/_/g, ' ')}.`,
    severity: 'info',
  });

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'contest resolved' });
  res.json({ success: true, data: { dispute, promise: result.promise } });
});
