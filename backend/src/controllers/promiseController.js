import mongoose from 'mongoose';
import {
  PromiseModel,
  Condition,
  Evidence,
  Verification,
  Payment,
  Dispute,
  AuditLog,
  User,
  PROMISE_STATUS,
  PAYMENT_STATUS,
  DISPUTE_STATUS,
  AUDIT_ACTION,
  NOTIFICATION_TYPE,
  CONDITION_STATUS,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from '../services/auditService.js';
import { notify, stakeholderIds } from '../services/notificationService.js';
import { recalculatePromise, explainPromise } from '../services/proofEngine.js';
import * as paymentService from '../services/paymentService.js';
import * as payoutService from '../services/payoutService.js';
import { publishUpdate } from '../services/eventBus.js';
import { loadPromiseForUser, relationTo, isPayer } from './helpers.js';

/** Attaches a recipient's ProofPay account to a promise when one exists. */
async function resolveRecipientUser(email) {
  if (!email) return null;
  const user = await User.findOne({ email });
  return user?._id ?? null;
}

export const listPromises = asyncHandler(async (req, res) => {
  const { status, search, role, sort, page, limit } = req.validatedQuery;

  const filter = { ...PromiseModel.visibilityFilter(req.user) };
  if (status && status !== 'ALL') filter.status = status;
  if (role === 'payer') filter.payer = req.user._id;
  if (role === 'recipient') {
    filter.$and = [
      { $or: [{ 'recipient.user': req.user._id }, { 'recipient.email': req.user.email }] },
    ];
  }
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const numeric = Number(search.replace(/[^\d.]/g, ''));
    filter.$and = [
      ...(filter.$and ?? []),
      {
        $or: [
          { title: rx },
          { description: rx },
          { publicId: rx },
          { 'recipient.name': rx },
          { 'recipient.email': rx },
          ...(Number.isFinite(numeric) && numeric > 0 ? [{ amount: numeric }] : []),
        ],
      },
    ];
  }

  const sortMap = {
    recent: { createdAt: -1 },
    amount: { amount: -1 },
    deadline: { deadline: 1 },
    health: { 'promiseHealth.overall': 1 },
  };

  const [promises, total, statusCounts] = await Promise.all([
    PromiseModel.find(filter)
      .sort(sortMap[sort])
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PromiseModel.countDocuments(filter),
    // Filter counts come from the same visibility rules, ignoring the status filter.
    PromiseModel.aggregate([
      { $match: PromiseModel.visibilityFilter(req.user) },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } },
    ]),
  ]);

  const ids = promises.map((promise) => promise._id);
  const [conditionRows, evidenceRows] = await Promise.all([
    Condition.aggregate([
      { $match: { promise: { $in: ids } } },
      {
        $group: {
          _id: '$promise',
          total: { $sum: 1 },
          verified: {
            $sum: { $cond: [{ $in: ['$status', ['VERIFIED', 'WAIVED']] }, 1, 0] },
          },
        },
      },
    ]),
    Evidence.aggregate([{ $match: { promise: { $in: ids } } }, { $group: { _id: '$promise', total: { $sum: 1 } } }]),
  ]);

  const conditionMap = new Map(conditionRows.map((row) => [String(row._id), row]));
  const evidenceMap = new Map(evidenceRows.map((row) => [String(row._id), row.total]));

  res.json({
    success: true,
    data: {
      promises: promises.map((promise) => ({
        ...promise,
        id: promise._id,
        relation: relationTo(promise, req.user),
        conditionSummary: {
          total: conditionMap.get(String(promise._id))?.total ?? 0,
          verified: conditionMap.get(String(promise._id))?.verified ?? 0,
        },
        evidenceCount: evidenceMap.get(String(promise._id)) ?? 0,
      })),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      statusCounts: statusCounts.map((row) => ({ status: row._id, count: row.count, value: row.value })),
    },
  });
});

/** Everything the Promise Map, health panel and vault need, in one round trip. */
export const getPromise = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user);

  const [conditions, evidence, verifications, payment, disputes] = await Promise.all([
    Condition.find({ promise: promise._id }).sort({ order: 1, createdAt: 1 }).lean(),
    Evidence.find({ promise: promise._id })
      .sort({ createdAt: -1 })
      .populate('submittedBy', 'name email avatar')
      .lean(),
    Verification.find({ promise: promise._id })
      .sort({ createdAt: -1 })
      .populate('performedBy', 'name avatar')
      .lean(),
    Payment.findOne({ promise: promise._id }).sort({ createdAt: -1 }).lean(),
    Dispute.find({ promise: promise._id }).sort({ createdAt: -1 }).lean(),
  ]);

  res.json({
    success: true,
    data: {
      promise: { ...promise.toObject(), id: promise._id, relation: relationTo(promise, req.user) },
      conditions,
      evidence,
      verifications,
      payment,
      disputes,
      permissions: {
        canFund: isPayer(promise, req.user) && !payment?.fundedAt,
        canFulfil:
          isPayer(promise, req.user) &&
          promise.status === PROMISE_STATUS.READY_TO_FULFILL &&
          payment?.status === PAYMENT_STATUS.HELD,
        canEdit: isPayer(promise, req.user) && !['FULFILLED', 'CANCELLED'].includes(promise.status),
        canContest: !['FULFILLED', 'CANCELLED'].includes(promise.status),
      },
    },
  });
});

export const createPromise = asyncHandler(async (req, res) => {
  const body = req.body;
  const recipientUser = await resolveRecipientUser(body.recipient.email);

  const promise = await PromiseModel.create({
    title: body.title,
    description: body.description,
    sourceText: body.sourceText,
    purpose: body.purpose,
    outcome: body.outcome,
    amount: body.amount,
    currency: body.currency,
    payer: req.user._id,
    recipient: {
      user: recipientUser,
      name: body.recipient.name,
      email: body.recipient.email ?? null,
      role: 'recipient',
    },
    participants: [
      { user: req.user._id, name: req.user.name, email: req.user.email, role: 'payer', confirmed: true },
    ],
    deadline: body.deadline ?? null,
    status: PROMISE_STATUS.DRAFT,
    ambiguityFlags: body.ambiguityFlags,
  });

  await Condition.insertMany(
    body.conditions.map((condition, index) => ({
      promise: promise._id,
      order: index,
      label: `Condition ${String(index + 1).padStart(2, '0')}`,
      description: condition.description,
      type: condition.type,
      verificationMethod: condition.verificationMethod,
      requiredEvidence: condition.requiredEvidence,
      weight: condition.weight,
    }))
  );

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.PROMISE_CREATED,
    summary: `Promise created — ${promise.amount} ${promise.currency} to ${promise.recipient.name}`,
    metadata: { conditions: body.conditions.length, publicId: promise.publicId },
    ip: req.ip,
  });
  for (const [index, condition] of body.conditions.entries()) {
    await recordAudit({
      user: req.user,
      promise,
      action: AUDIT_ACTION.CONDITION_CREATED,
      summary: `Condition ${String(index + 1).padStart(2, '0')} — ${condition.description.slice(0, 90)}`,
    });
  }

  await notify({
    users: [recipientUser].filter(Boolean),
    promise,
    type: NOTIFICATION_TYPE.PROMISE_CREATED,
    title: 'A promise names you',
    body: `${req.user.name} created ${promise.title} for ${promise.amount} ${promise.currency}.`,
  });

  const recalculated = await recalculatePromise(promise._id, { actor: req.user, reason: 'created' });

  res.status(201).json({
    success: true,
    data: { promise: recalculated.promise, conditions: recalculated.conditions },
  });
});

export const updatePromise = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user, { mustBePayer: true });
  if ([PROMISE_STATUS.FULFILLED, PROMISE_STATUS.CANCELLED].includes(promise.status)) {
    throw ApiError.conflict('A fulfilled or cancelled promise can no longer be edited.');
  }

  const payment = await Payment.findOne({ promise: promise._id });
  const changed = {};
  for (const field of ['title', 'description', 'outcome', 'deadline']) {
    if (req.body[field] !== undefined && String(req.body[field]) !== String(promise[field])) {
      changed[field] = { from: promise[field], to: req.body[field] };
      promise[field] = req.body[field];
    }
  }
  if (req.body.amount !== undefined && req.body.amount !== promise.amount) {
    if (payment && payment.status !== PAYMENT_STATUS.PENDING) {
      throw ApiError.conflict('The amount cannot change once money is held against this promise.');
    }
    changed.amount = { from: promise.amount, to: req.body.amount };
    promise.amount = req.body.amount;
  }
  if (req.body.currency && req.body.currency !== promise.currency) {
    if (payment && payment.status !== PAYMENT_STATUS.PENDING) {
      throw ApiError.conflict('The currency cannot change once money is held against this promise.');
    }
    promise.currency = req.body.currency;
  }
  if (req.body.recipient) {
    if (req.body.recipient.name) promise.recipient.name = req.body.recipient.name;
    if (req.body.recipient.email !== undefined) {
      promise.recipient.email = req.body.recipient.email;
      promise.recipient.user = await resolveRecipientUser(req.body.recipient.email);
    }
  }

  await promise.save();
  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.PROMISE_MODIFIED,
    summary: `Promise modified — ${Object.keys(changed).join(', ') || 'details updated'}`,
    metadata: changed,
    ip: req.ip,
  });

  const recalculated = await recalculatePromise(promise._id, { actor: req.user, reason: 'edited' });
  res.json({ success: true, data: { promise: recalculated.promise } });
});

/** Promises are cancelled, never erased — the Chronicle has to stay complete. */
export const cancelPromise = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user, { mustBePayer: true });
  if (promise.status === PROMISE_STATUS.FULFILLED) {
    throw ApiError.conflict('A fulfilled promise cannot be cancelled.');
  }

  const payment = await Payment.findOne({ promise: promise._id });
  if (payment && [PAYMENT_STATUS.HELD, PAYMENT_STATUS.FUNDED].includes(payment.status)) {
    await paymentService.refundPayment({
      payment,
      authorisedBy: req.user,
      reason: 'Promise cancelled by the payer',
    });
    await recordAudit({
      user: req.user,
      promise,
      action: AUDIT_ACTION.PAYMENT_REFUNDED,
      summary: `${payment.amount} ${payment.currency} returned to the payer`,
      ip: req.ip,
    });
  }

  promise.status = PROMISE_STATUS.CANCELLED;
  promise.cancelledAt = new Date();
  await promise.save();

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.PROMISE_CANCELLED,
    summary: 'Promise cancelled',
    ip: req.ip,
  });
  await notify({
    users: stakeholderIds(promise),
    promise,
    type: NOTIFICATION_TYPE.PROMISE_CONTESTED,
    title: 'Promise cancelled',
    body: `${promise.title} was cancelled${payment ? ' and any held amount was returned' : ''}.`,
    severity: 'warning',
  });
  publishUpdate({ userIds: stakeholderIds(promise).map(String), type: 'promise.updated', data: { promiseId: String(promise._id) } });

  res.json({ success: true, data: { promise } });
});

/**
 * Everything that becomes true once money is actually held. Both funding paths
 * end here — demo settles in one request, Razorpay settles after the browser
 * comes back with a signature — so a promise is recorded, audited and announced
 * identically no matter which provider moved it.
 */
async function completeFunding({ promise, funded, checkout, user, ip }) {
  promise.fundedAt = funded.fundedAt;
  await promise.save();

  await recordAudit({
    user,
    promise,
    action: AUDIT_ACTION.PROMISE_FUNDED,
    summary: `${funded.amount} ${funded.currency} held against this promise`,
    entity: { type: 'Payment', id: funded._id },
    metadata: { provider: funded.provider, reference: funded.providerReference },
    ip,
  });
  await notify({
    users: stakeholderIds(promise),
    promise,
    type: NOTIFICATION_TYPE.PROMISE_FUNDED,
    title: 'Promise funded',
    body: `${funded.amount} ${funded.currency} is now conditional on ${promise.title}.`,
    severity: 'success',
  });

  const recalculated = await recalculatePromise(promise._id, { actor: user, reason: 'funded' });
  return { promise: recalculated.promise, payment: funded, checkout, requiresPayment: false };
}

/** Shared guards for both funding steps. */
async function loadFundablePromise(req) {
  const promise = await loadPromiseForUser(req.params.id, req.user, { mustBePayer: true });
  if ([PROMISE_STATUS.FULFILLED, PROMISE_STATUS.CANCELLED].includes(promise.status)) {
    throw ApiError.conflict('This promise is closed.');
  }
  return promise;
}

/**
 * Opens funding. Demo settles immediately. Razorpay cannot: the payer has to
 * authorise the charge in the provider's own checkout, so this returns the order
 * to hand to it and leaves the payment PENDING until /fund/verify sees a valid
 * signature. Nothing is held, and the promise is untouched, until then.
 */
export const fundPromise = asyncHandler(async (req, res) => {
  const promise = await loadFundablePromise(req);

  const conditionCount = await Condition.countDocuments({ promise: promise._id });
  if (!conditionCount) throw ApiError.badRequest('Add at least one condition before funding this promise.');

  const { payment, checkout } = await paymentService.createPayment({ promise, payer: req.user });

  if (checkout.provider === 'razorpay') {
    return res.json({
      success: true,
      data: { promise, payment, checkout, requiresPayment: true },
    });
  }

  const funded = await paymentService.verifyPayment({ payment, providerPayload: req.body.providerPayload });
  res.json({
    success: true,
    data: await completeFunding({ promise, funded, checkout, user: req.user, ip: req.ip }),
  });
});

/**
 * Second leg of a provider checkout: the browser returns what the provider
 * signed, and the signature is checked here with the secret — which never
 * leaves the server. A payer cannot talk their way past this by posting their
 * own payload, because the HMAC is over the provider's own order and payment ids.
 */
export const verifyFunding = asyncHandler(async (req, res) => {
  const promise = await loadFundablePromise(req);

  // FAILED is included deliberately: a mistyped or tampered confirmation must not
  // strand an order the payer legitimately opened. The HMAC is the security
  // control here, not the status field — a retry still has to carry a signature
  // this server can reproduce from its own secret.
  const payment = await Payment.findOne({
    promise: promise._id,
    status: {
      $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FUNDED, PAYMENT_STATUS.HELD, PAYMENT_STATUS.FAILED],
    },
  }).sort({ createdAt: -1 });

  if (!payment) throw ApiError.notFound('There is no open funding attempt on this promise.');
  if ([PAYMENT_STATUS.HELD, PAYMENT_STATUS.FUNDED].includes(payment.status)) {
    throw ApiError.conflict('This promise is already funded.');
  }

  const funded = await paymentService.verifyPayment({ payment, providerPayload: req.body.providerPayload });
  res.json({
    success: true,
    data: await completeFunding({
      promise,
      funded,
      checkout: { provider: funded.provider, amount: funded.amount, currency: funded.currency },
      user: req.user,
      ip: req.ip,
    }),
  });
});

/**
 * Fulfillment. The Proof Engine has no route into this function: it requires an
 * authenticated payer, an explicit confirmation flag, and a promise the backend
 * itself has already scored as ready.
 */
export const fulfilPromise = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user, { mustBePayer: true });
  const recalculated = await recalculatePromise(promise._id, { actor: req.user });
  const current = recalculated.promise;

  if (current.status === PROMISE_STATUS.FULFILLED) {
    throw ApiError.conflict('This promise has already been fulfilled.');
  }
  if (current.status === PROMISE_STATUS.CONTESTED) {
    throw ApiError.conflict('This promise is contested. Resolve the contest before releasing money.');
  }
  if (current.status !== PROMISE_STATUS.READY_TO_FULFILL) {
    const remaining = recalculated.conditions.filter(
      (condition) => ![CONDITION_STATUS.VERIFIED, CONDITION_STATUS.WAIVED].includes(condition.status)
    );
    throw ApiError.conflict(
      remaining.length
        ? `${remaining.length} condition${remaining.length > 1 ? 's are' : ' is'} still unproven. Money moves when the promise is proven.`
        : 'This promise is not ready for fulfillment yet.'
    );
  }

  const payment = recalculated.payment;
  if (!payment) throw ApiError.conflict('There is nothing held against this promise.');

  const released = await paymentService.releasePayment({ payment, authorisedBy: req.user });

  // The release is the payer's decision; the payout is the bank rail carrying it
  // out. A rail failure is recorded on the payment rather than thrown, because
  // the decision stands either way and the money is still accounted for.
  released.payout = await payoutService.sendPayout({ payment: released, promise: current });
  await released.save();

  current.status = PROMISE_STATUS.FULFILLED;
  current.fulfilledAt = released.releasedAt;
  await current.save();

  await recordAudit({
    user: req.user,
    promise: current,
    action: AUDIT_ACTION.PAYMENT_RELEASED,
    summary: `${released.amount} ${released.currency} released to ${current.recipient.name}`,
    entity: { type: 'Payment', id: released._id },
    metadata: {
      note: req.body.note,
      reference: released.providerReference,
      payout: { status: released.payout?.status, id: released.payout?.id ?? null },
    },
    ip: req.ip,
  });
  await recordAudit({
    user: req.user,
    promise: current,
    action: AUDIT_ACTION.PROMISE_FULFILLED,
    summary: 'Promise fulfilled — every condition proven',
    ip: req.ip,
  });
  await notify({
    users: stakeholderIds(current),
    promise: current,
    type: NOTIFICATION_TYPE.PAYMENT_FULFILLED,
    title: 'Payment fulfilled',
    body: `${released.amount} ${released.currency} released to ${current.recipient.name}. ${payoutService.describePayout(released.payout)}`,
    severity: 'success',
  });
  publishUpdate({
    userIds: stakeholderIds(current).map(String),
    type: 'promise.updated',
    data: { promiseId: String(current._id), status: PROMISE_STATUS.FULFILLED },
  });

  res.json({
    success: true,
    data: {
      promise: current,
      payment: released,
      payout: { ...(released.payout?.toObject?.() ?? released.payout), summary: payoutService.describePayout(released.payout) },
    },
  });
});

/**
 * Records where the recipient should be paid. Either side of the promise may
 * add it — the payer often knows the details, and a recipient with an account
 * should not have to send them over email.
 */
export const setPayoutDestination = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user);
  if (promise.status === PROMISE_STATUS.FULFILLED) {
    throw ApiError.conflict('This promise is already fulfilled — its payout has been sent.');
  }

  const { method, ...details } = req.body;
  const destination = await payoutService.createDestination({ promise, method, details });

  promise.recipient.payoutDestination = destination;
  await promise.save();

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.PROMISE_UPDATED,
    // The label is masked at creation, so nothing sensitive reaches the Chronicle.
    summary: `Payout destination set for ${promise.recipient.name} — ${destination.label}`,
    ip: req.ip,
  });

  res.json({ success: true, data: { promise, destination } });
});

/**
 * Re-reads a payout that is still in flight — and re-sends one that never
 * reached the provider at all. A payout that failed before it was created has
 * no id to poll, so without this a release whose rail was down would strand the
 * money with no way back except a database edit.
 */
export const refreshPayoutStatus = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user);
  const payment = await paymentService.getPaymentStatus(promise._id);
  if (!payment) throw ApiError.notFound('There is no payment on this promise.');
  if (payment.status !== PAYMENT_STATUS.RELEASED) {
    throw ApiError.conflict('Nothing has been released on this promise yet.');
  }

  const existing = payment.payout ?? {};
  // Retrying is safe: sendPayout keys on the payment id, so the provider
  // settles a repeated request once rather than paying twice.
  const payout = existing.id
    ? await payoutService.refreshPayout(payment, promise)
    : await payoutService.sendPayout({ payment, promise });

  payment.payout = payout;
  await payment.save();

  res.json({
    success: true,
    data: { payment, payout: { ...(payout.toObject?.() ?? payout), summary: payoutService.describePayout(payout) } },
  });
});

/** The Chronicle for one promise. */
export const promiseChronicle = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user);
  const entries = await AuditLog.find({ promise: promise._id })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('user', 'name avatar')
    .lean();
  res.json({ success: true, data: { entries } });
});

/** A Proof Engine reading of where this promise stands, in words. */
export const promiseBriefing = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user);
  const conditions = await Condition.find({ promise: promise._id }).sort({ order: 1 }).lean();
  if (!conditions.length) throw ApiError.badRequest('This promise has no conditions to read yet.');

  const result = await explainPromise({
    promise,
    conditions,
    health: promise.promiseHealth,
    confidence: promise.proofConfidence,
    user: req.user,
  });

  res.json({ success: true, data: { ...result.data, engine: result.engine, model: result.model } });
});

/** Global search across the promises this user may see. */
export const searchPromises = asyncHandler(async (req, res) => {
  const term = String(req.query.q ?? '').trim();
  if (term.length < 2) return res.json({ success: true, data: { promises: [], term } });

  const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const numeric = Number(term.replace(/[^\d.]/g, ''));

  const promises = await PromiseModel.find({
    $and: [
      PromiseModel.visibilityFilter(req.user),
      {
        $or: [
          { title: rx },
          { publicId: rx },
          { description: rx },
          { 'recipient.name': rx },
          { 'recipient.email': rx },
          { status: rx },
          ...(Number.isFinite(numeric) && numeric > 0 ? [{ amount: numeric }] : []),
        ],
      },
    ],
  })
    .limit(20)
    .lean();

  res.json({ success: true, data: { promises, term } });
});

export const recalculate = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user);
  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'manual refresh' });
  res.json({ success: true, data: { promise: result.promise, conditions: result.conditions } });
});
