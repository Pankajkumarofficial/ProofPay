import {
  Condition,
  Evidence,
  Verification,
  PROMISE_STATUS,
  AUDIT_ACTION,
  CONDITION_STATUS,
  VERDICT,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from '../services/auditService.js';
import { recalculatePromise } from '../services/proofEngine.js';
import { loadPromiseForUser, isPayer } from './helpers.js';

export const listConditions = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user);
  const conditions = await Condition.find({ promise: promise._id }).sort({ order: 1, createdAt: 1 }).lean();
  res.json({ success: true, data: { conditions } });
});

/** Adding a condition immediately changes the Promise Map and every score. */
export const createCondition = asyncHandler(async (req, res) => {
  const promise = await loadPromiseForUser(req.params.id, req.user, { mustBePayer: true });
  if ([PROMISE_STATUS.FULFILLED, PROMISE_STATUS.CANCELLED].includes(promise.status)) {
    throw ApiError.conflict('This promise is closed; its conditions can no longer change.');
  }

  const count = await Condition.countDocuments({ promise: promise._id });
  if (count >= 12) throw ApiError.badRequest('A promise can hold up to 12 conditions.');

  const condition = await Condition.create({
    promise: promise._id,
    order: count,
    label: `Condition ${String(count + 1).padStart(2, '0')}`,
    description: req.body.description,
    type: req.body.type,
    verificationMethod: req.body.verificationMethod,
    requiredEvidence: req.body.requiredEvidence,
    weight: req.body.weight,
  });

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.CONDITION_CREATED,
    summary: `${condition.label} added — ${condition.description.slice(0, 90)}`,
    entity: { type: 'Condition', id: condition._id },
    ip: req.ip,
  });

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'condition added' });
  res.status(201).json({ success: true, data: { condition, promise: result.promise, conditions: result.conditions } });
});

export const updateCondition = asyncHandler(async (req, res) => {
  const condition = await Condition.findById(req.params.id);
  if (!condition) throw ApiError.notFound('That condition no longer exists.');
  const promise = await loadPromiseForUser(condition.promise, req.user, { mustBePayer: true });

  const changed = [];
  for (const field of ['description', 'type', 'verificationMethod', 'requiredEvidence', 'weight', 'order', 'notes']) {
    if (req.body[field] !== undefined) {
      changed.push(field);
      condition[field] = req.body[field];
    }
  }
  if (req.body.status) {
    // Only a deliberate waiver or failure is settable by hand; everything else
    // is derived from validations.
    changed.push('status');
    condition.status = req.body.status;
    if (req.body.status === CONDITION_STATUS.WAIVED) {
      condition.confidence = 100;
      condition.verifiedAt = new Date();
      condition.verifiedBy = req.user._id;
    }
    if (req.body.status === CONDITION_STATUS.FAILED) condition.confidence = 0;
  }
  await condition.save();

  await recordAudit({
    user: req.user,
    promise,
    action:
      req.body.status === CONDITION_STATUS.FAILED
        ? AUDIT_ACTION.CONDITION_FAILED
        : AUDIT_ACTION.CONDITION_MODIFIED,
    summary: `${condition.label || 'Condition'} updated — ${changed.join(', ')}`,
    entity: { type: 'Condition', id: condition._id },
    metadata: { fields: changed },
    ip: req.ip,
  });

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'condition updated' });
  res.json({ success: true, data: { condition, promise: result.promise, conditions: result.conditions } });
});

export const deleteCondition = asyncHandler(async (req, res) => {
  const condition = await Condition.findById(req.params.id);
  if (!condition) throw ApiError.notFound('That condition no longer exists.');
  const promise = await loadPromiseForUser(condition.promise, req.user, { mustBePayer: true });

  const remaining = await Condition.countDocuments({ promise: promise._id });
  if (remaining <= 1) throw ApiError.badRequest('A promise must keep at least one condition.');
  const proofCount = await Evidence.countDocuments({ condition: condition._id });
  if (proofCount) {
    throw ApiError.conflict('Proof has already been submitted against this condition, so it cannot be removed.');
  }

  await condition.deleteOne();
  await Verification.deleteMany({ condition: condition._id });

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.CONDITION_REMOVED,
    summary: `${condition.label || 'Condition'} removed — ${condition.description.slice(0, 90)}`,
    ip: req.ip,
  });

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'condition removed' });
  res.json({ success: true, data: { promise: result.promise, conditions: result.conditions } });
});

/**
 * A human validation. The payer confirming a condition is itself proof of the
 * "participant confirmation" kind, and it is recorded as a Verification like any
 * other, so the Chronicle reads the same for people and for the Proof Engine.
 */
export const confirmCondition = asyncHandler(async (req, res) => {
  const condition = await Condition.findById(req.params.id);
  if (!condition) throw ApiError.notFound('That condition no longer exists.');
  const promise = await loadPromiseForUser(condition.promise, req.user);

  const canConfirm = isPayer(promise, req.user) || String(promise.recipient?.user) === String(req.user._id);
  if (!canConfirm) throw ApiError.forbidden('Only the promise participants can confirm a condition.');

  await Verification.create({
    promise: promise._id,
    condition: condition._id,
    method: 'participant',
    verdict: req.body.approve ? VERDICT.SUPPORTS : VERDICT.CONTRADICTS,
    confidence: req.body.approve ? 100 : 0,
    explanation: req.body.approve
      ? `${req.user.name} confirmed this condition is satisfied.${req.body.note ? ` "${req.body.note}"` : ''}`
      : `${req.user.name} states this condition is not satisfied.${req.body.note ? ` "${req.body.note}"` : ''}`,
    performedBy: req.user._id,
    engine: 'participant',
  });

  await recordAudit({
    user: req.user,
    promise,
    action: req.body.approve ? AUDIT_ACTION.CONDITION_VERIFIED : AUDIT_ACTION.CONDITION_FAILED,
    summary: `${req.user.name} ${req.body.approve ? 'confirmed' : 'rejected'} ${condition.label || 'a condition'}`,
    entity: { type: 'Condition', id: condition._id },
    ip: req.ip,
  });

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'participant confirmation' });
  res.json({ success: true, data: { promise: result.promise, conditions: result.conditions } });
});
