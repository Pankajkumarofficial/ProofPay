import fs from 'node:fs/promises';
import path from 'node:path';
import {
  Evidence,
  Condition,
  PromiseModel,
  EVIDENCE_STATUS,
  CONDITION_STATUS,
  AUDIT_ACTION,
  NOTIFICATION_TYPE,
  VERDICT,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from '../services/auditService.js';
import { notify, stakeholderIds } from '../services/notificationService.js';
import { assessEvidence, recordVerification, recalculatePromise } from '../services/proofEngine.js';
import { UPLOAD_DIR } from '../middleware/upload.js';
import { loadPromiseForUser } from './helpers.js';

/** Text-shaped proof is read so the engine can judge contents, not file names. */
const READABLE = ['text/plain', 'text/csv', 'application/json', 'text/markdown'];

async function readTextEvidence(file) {
  if (!file || !READABLE.includes(file.mimetype)) return null;
  try {
    const contents = await fs.readFile(path.join(UPLOAD_DIR, file.filename), 'utf8');
    return contents.slice(0, 20000);
  } catch {
    return null;
  }
}

export const listEvidence = asyncHandler(async (req, res) => {
  const { promiseId, conditionId, type, status, search, limit } = req.validatedQuery;

  // Restricted to promises this user can see — the vault is never a global list.
  const visible = await PromiseModel.find(PromiseModel.visibilityFilter(req.user)).select('_id title publicId currency').lean();
  const visibleIds = visible.map((promise) => promise._id);

  const filter = { promise: { $in: visibleIds } };
  if (promiseId) {
    if (!visibleIds.some((id) => String(id) === promiseId)) {
      throw ApiError.forbidden('That promise is not yours to view.');
    }
    filter.promise = promiseId;
  }
  if (conditionId) filter.condition = conditionId;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { note: rx }, { fileName: rx }, { url: rx }, { source: rx }];
  }

  const [evidence, typeCounts] = await Promise.all([
    Evidence.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('submittedBy', 'name email avatar')
      .populate('condition', 'label description status')
      .populate('promise', 'title publicId currency amount status')
      .lean(),
    Evidence.aggregate([
      { $match: { promise: { $in: visibleIds } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      evidence,
      typeCounts: typeCounts.map((row) => ({ type: row._id, count: row.count })),
      promises: visible,
    },
  });
});

export const getEvidence = asyncHandler(async (req, res) => {
  const evidence = await Evidence.findById(req.params.id)
    .populate('submittedBy', 'name email avatar')
    .populate('condition', 'label description status requiredEvidence verificationMethod');
  if (!evidence) throw ApiError.notFound('That proof is no longer in the vault.');
  await loadPromiseForUser(evidence.promise, req.user);
  res.json({ success: true, data: { evidence } });
});

/**
 * Submits proof. Accepts a file, a link, or a written note, and by default asks
 * the Proof Engine to assess it against the condition it was filed under.
 */
export const createEvidence = asyncHandler(async (req, res) => {
  const body = req.body;
  const promise = await loadPromiseForUser(body.promiseId, req.user);
  if (['FULFILLED', 'CANCELLED'].includes(promise.status)) {
    throw ApiError.conflict('This promise is closed; no further proof can be filed.');
  }

  let condition = null;
  if (body.conditionId) {
    condition = await Condition.findOne({ _id: body.conditionId, promise: promise._id });
    if (!condition) throw ApiError.badRequest('That condition does not belong to this promise.');
  }

  const file = req.file;
  if (!file && !body.url && !body.note) {
    throw ApiError.badRequest('Attach a file, add a link, or write a note — proof needs a substance.');
  }

  const extractedText = await readTextEvidence(file);

  const evidence = await Evidence.create({
    promise: promise._id,
    condition: condition?._id ?? null,
    submittedBy: req.user._id,
    title: body.title || file?.originalname || body.url || 'Written statement',
    type: body.type,
    source: file ? 'upload' : body.url ? 'link' : body.source || 'note',
    fileUrl: file ? `/uploads/${file.filename}` : null,
    fileName: file?.originalname ?? null,
    fileSize: file?.size ?? null,
    mimeType: file?.mimetype ?? null,
    url: body.url ?? null,
    note: body.note,
    metadata: extractedText ? { extractedChars: extractedText.length } : {},
    status: EVIDENCE_STATUS.SUBMITTED,
  });

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.EVIDENCE_SUBMITTED,
    summary: `Proof submitted — ${evidence.title.slice(0, 90)}${condition ? ` for ${condition.label}` : ''}`,
    entity: { type: 'Evidence', id: evidence._id },
    metadata: { type: evidence.type, condition: condition?.label },
    ip: req.ip,
  });
  await notify({
    users: stakeholderIds(promise).filter((id) => String(id) !== String(req.user._id)),
    promise,
    type: NOTIFICATION_TYPE.PROOF_RECEIVED,
    title: 'Proof received',
    body: `${req.user.name} filed ${evidence.title.slice(0, 80)}${condition ? ` against ${condition.label}` : ''}.`,
  });

  let assessment = null;
  if (condition && body.autoVerify) {
    assessment = await runAssessment({ promise, condition, evidence, actor: req.user, extractedText });
  }

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'proof submitted' });

  res.status(201).json({
    success: true,
    data: {
      evidence: await Evidence.findById(evidence._id).populate('submittedBy', 'name avatar').lean(),
      assessment,
      promise: result.promise,
      conditions: result.conditions,
    },
  });
});

/** Runs the engine against one piece of proof and writes down what it decided. */
async function runAssessment({ promise, condition, evidence, actor, extractedText = null }) {
  evidence.status = EVIDENCE_STATUS.VERIFYING;
  await evidence.save();

  const siblings = await Evidence.find({
    promise: promise._id,
    _id: { $ne: evidence._id },
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const result = await assessEvidence({
    promise,
    condition,
    evidence: { ...evidence.toObject(), extractedText },
    siblingEvidence: siblings,
    user: actor,
  });

  await recordVerification({
    promise,
    condition,
    evidence,
    assessment: result.data,
    engine: result.engine,
    model: result.model,
    actor,
  });

  await recordAudit({
    user: actor,
    promise,
    action: AUDIT_ACTION.EVIDENCE_VERIFIED,
    summary: `Proof Engine assessed ${evidence.title.slice(0, 70)} — ${result.data.verdict} at ${result.data.confidence}%`,
    entity: { type: 'Evidence', id: evidence._id },
    metadata: { engine: result.engine, model: result.model, verdict: result.data.verdict },
  });

  if (result.data.verdict === VERDICT.CONTRADICTS) {
    await notify({
      users: stakeholderIds(promise),
      promise,
      type: NOTIFICATION_TYPE.EVIDENCE_CONFLICT,
      title: 'Evidence conflict detected',
      body: result.data.explanation.slice(0, 200),
      severity: 'critical',
    });
  }

  return { ...result.data, engine: result.engine, model: result.model };
}

/** Explicit re-verification, e.g. after the condition wording changed. */
export const verifyEvidence = asyncHandler(async (req, res) => {
  const evidence = await Evidence.findById(req.params.id);
  if (!evidence) throw ApiError.notFound('That proof is no longer in the vault.');

  const promise = await loadPromiseForUser(evidence.promise, req.user);
  const conditionId = req.body?.conditionId ?? evidence.condition;
  if (!conditionId) {
    throw ApiError.badRequest('File this proof against a condition before asking the Proof Engine to assess it.');
  }

  const condition = await Condition.findOne({ _id: conditionId, promise: promise._id });
  if (!condition) throw ApiError.badRequest('That condition does not belong to this promise.');

  if (String(evidence.condition ?? '') !== String(condition._id)) {
    evidence.condition = condition._id;
    await evidence.save();
  }

  const extractedText = evidence.mimeType && READABLE.includes(evidence.mimeType)
    ? await readTextEvidence({ mimetype: evidence.mimeType, filename: path.basename(evidence.fileUrl ?? '') })
    : null;

  const assessment = await runAssessment({ promise, condition, evidence, actor: req.user, extractedText });
  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'proof re-assessed' });

  res.json({
    success: true,
    data: {
      assessment,
      evidence: await Evidence.findById(evidence._id).lean(),
      promise: result.promise,
      conditions: result.conditions,
    },
  });
});

/** Only the submitter may withdraw proof, and only before it has been accepted. */
export const deleteEvidence = asyncHandler(async (req, res) => {
  const evidence = await Evidence.findById(req.params.id);
  if (!evidence) throw ApiError.notFound('That proof is no longer in the vault.');
  const promise = await loadPromiseForUser(evidence.promise, req.user);

  if (String(evidence.submittedBy) !== String(req.user._id)) {
    throw ApiError.forbidden('Only the person who filed this proof can withdraw it.');
  }
  if (evidence.status === EVIDENCE_STATUS.ACCEPTED) {
    throw ApiError.conflict('Accepted proof stays on the record. Contest the promise instead.');
  }

  await evidence.deleteOne();
  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.EVIDENCE_SUBMITTED,
    summary: `Proof withdrawn — ${evidence.title.slice(0, 90)}`,
    metadata: { withdrawn: true },
    ip: req.ip,
  });

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'proof withdrawn' });
  res.json({ success: true, data: { promise: result.promise, conditions: result.conditions } });
});

export { runAssessment };
