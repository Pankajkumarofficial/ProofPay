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
  CLOSED_PROMISE_STATUS,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from '../services/auditService.js';
import { notify, stakeholderIds } from '../services/notificationService.js';
import { assessEvidence, recordVerification, recalculatePromise } from '../services/proofEngine.js';
import { publishUpdate } from '../services/eventBus.js';
import { logger } from '../utils/logger.js';
import { UPLOAD_DIR } from '../middleware/upload.js';
import { loadPromiseForUser } from './helpers.js';

/** Text-shaped proof is read so the engine can judge contents, not file names. */
const READABLE = ['text/plain', 'text/csv', 'application/json', 'text/markdown'];

/**
 * Proof that has to be looked at rather than read: a screenshot of a transfer,
 * a photo of the finished work, a scanned receipt. These go to the Proof Engine
 * as the artefact itself, so it judges what the picture shows instead of what
 * the file happens to be called.
 */
const VIEWABLE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

/**
 * Above this, sending the file costs more than the reading is worth — and the
 * providers reject oversized inline data anyway. A screenshot of a payment is
 * a fraction of it; the engine falls back to the file name for anything larger,
 * and says so.
 */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * A PDF's words, pulled out here rather than left to the provider.
 *
 * Every vendor claims to read PDFs and each does it differently — Anthropic
 * takes a document block, Gemini takes inline data, and an OpenAI-compatible
 * gateway may accept the `file` part, ignore it in silence, or reject it. The
 * silent case is the dangerous one: the engine then reads a *filename*, caps its
 * confidence because the contents were not provided, and the interface shows a
 * reading of a document nobody opened. That is incident 1, and it returned the
 * day a gateway became the active path.
 *
 * Text extracted on this side travels as text to every provider, so the artefact
 * reaches the model whatever the endpoint happens to support. The bytes are
 * still attached where they are understood — this is the floor, not a
 * replacement for a model that can genuinely see the page.
 */
async function readPdfText(absolutePath) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const bytes = new Uint8Array(await fs.readFile(absolutePath));
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return typeof text === 'string' ? text.trim() : null;
}

async function readTextEvidence(file) {
  if (!file) return null;
  const isPdf = file.mimetype === 'application/pdf';
  if (!isPdf && !READABLE.includes(file.mimetype)) return null;
  try {
    const absolutePath = path.join(UPLOAD_DIR, file.filename);
    const contents = isPdf
      ? await readPdfText(absolutePath)
      : await fs.readFile(absolutePath, 'utf8');
    // A scanned page extracts to nothing. Returning '' would read as "the
    // document is empty" rather than "this one has to be looked at", so the
    // artefact is left to speak for itself.
    return contents ? contents.slice(0, 20000) : null;
  } catch {
    return null;
  }
}

/** The uploaded artefact as bytes the engine can look at, or null if it cannot. */
async function readViewableEvidence(file) {
  if (!file || !VIEWABLE.includes(file.mimetype)) return null;
  try {
    const bytes = await fs.readFile(path.join(UPLOAD_DIR, file.filename));
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return null;
    return { mimeType: file.mimetype, data: bytes.toString('base64') };
  } catch {
    return null;
  }
}

/** The stored upload behind a saved Evidence record, shaped like a fresh one. */
const storedFile = (evidence) =>
  evidence.fileUrl
    ? {
        mimetype: evidence.mimeType,
        filename: path.basename(evidence.fileUrl),
        originalname: evidence.fileName,
      }
    : null;

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
  if (CLOSED_PROMISE_STATUS.includes(promise.status)) {
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
  const attachment = await readViewableEvidence(file);

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

  const assessing = Boolean(condition && body.autoVerify);
  if (assessing) {
    // Marked before the response so the vault shows "being read" immediately,
    // rather than a submitted row that silently changes a minute later.
    evidence.status = EVIDENCE_STATUS.VERIFYING;
    await evidence.save();
  }

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'proof submitted' });

  res.status(201).json({
    success: true,
    data: {
      evidence: await Evidence.findById(evidence._id).populate('submittedBy', 'name avatar').lean(),
      // The reading happens after this response; the verdict arrives over the
      // event stream. `assessing` tells the client which of the two to expect.
      assessment: null,
      assessing,
      promise: result.promise,
      conditions: result.conditions,
    },
  });

  if (assessing) {
    assessInBackground({ promise, condition, evidence, actor: req.user, extractedText, attachment });
  }
});

/**
 * Assessments still running behind a response that has already been sent.
 *
 * Tracked for two reasons: a shutdown should drain them rather than abandon a
 * reading half-done, and a test needs a deterministic point to wait on now that
 * filing proof no longer returns the verdict.
 */
const inFlight = new Set();

/** Resolves once every background assessment started so far has settled. */
export const settleAssessments = () => Promise.allSettled([...inFlight]);

/**
 * Reads the proof after the response has gone out.
 *
 * Filing proof used to wait on the model: the person watched a spinner for as
 * long as the provider took, and a provider having a bad minute — a 30s timeout,
 * a retry, another 30s — could hold the form open for a minute before falling
 * back to the deterministic engine. None of that waiting bought them anything;
 * the verdict is written to the record either way, and every screen already
 * refetches when the promise changes.
 *
 * So the request returns as soon as the proof is in the vault, and this runs
 * behind it. Nothing is awaiting the result, which also means the engine can
 * afford to be patient — see `patient` in proofEngine.assessEvidence — and wait
 * out a rate limit that a person would never have sat through.
 */
function assessInBackground({ promise, condition, evidence, actor, extractedText, attachment }) {
  const stakeholders = stakeholderIds(promise).map(String);

  // Deliberately not awaited by the request. It must never reject: there is no
  // request left to fail, and an unhandled rejection would take the process down.
  const task = (async () => {
    try {
      const assessment = await runAssessment({
        promise,
        condition,
        evidence,
        actor,
        extractedText,
        attachment,
        patient: true,
      });
      await recalculatePromise(promise._id, { actor, reason: 'proof assessed' });

      // A nudge carrying the verdict, so the page that filed it can say what came
      // back without the person going looking for it.
      publishUpdate({
        userIds: stakeholders,
        type: 'evidence.assessed',
        data: {
          promiseId: String(promise._id),
          evidenceId: String(evidence._id),
          conditionId: String(condition._id),
          // Both sides' screens refresh; only the person who filed it is told
          // the verdict out loud, since only they were waiting to hear it.
          actorId: actor?._id ? String(actor._id) : null,
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          explanation: assessment.explanation,
          engine: assessment.engine,
          model: assessment.model,
        },
      });
    } catch (error) {
      logger.error(`Background assessment failed for evidence ${evidence._id}: ${error.message}`);
      // Leaving it VERIFYING would strand the row forever. Put it back to
      // submitted so a person can ask for it to be read again.
      try {
        const stranded = await Evidence.findById(evidence._id);
        if (stranded && stranded.status === EVIDENCE_STATUS.VERIFYING) {
          stranded.status = EVIDENCE_STATUS.SUBMITTED;
          await stranded.save();
        }
        await recalculatePromise(promise._id, { actor, reason: 'assessment failed' });
        publishUpdate({
          userIds: stakeholders,
          type: 'evidence.assessment_failed',
          data: { promiseId: String(promise._id), evidenceId: String(evidence._id) },
        });
      } catch (cleanupError) {
        logger.error(`Could not reset stranded evidence ${evidence._id}: ${cleanupError.message}`);
      }
    }
  })();

  inFlight.add(task);
  task.finally(() => inFlight.delete(task));
}

/** Runs the engine against one piece of proof and writes down what it decided. */
async function runAssessment({
  promise,
  condition,
  evidence,
  actor,
  extractedText = null,
  attachment = null,
  /** Set when nobody is waiting on the answer, so the engine may wait one out. */
  patient = false,
}) {
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
    attachments: attachment ? [attachment] : [],
    patient,
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

  const file = storedFile(evidence);
  const extractedText = await readTextEvidence(file);
  const attachment = await readViewableEvidence(file);

  // Re-reading is the same wait as the first read, so it is handled the same way:
  // the record says it is being read, and the verdict follows on the stream.
  evidence.status = EVIDENCE_STATUS.VERIFYING;
  await evidence.save();

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'proof re-assessed' });

  res.status(202).json({
    success: true,
    data: {
      assessment: null,
      assessing: true,
      evidence: await Evidence.findById(evidence._id).lean(),
      promise: result.promise,
      conditions: result.conditions,
    },
  });

  assessInBackground({ promise, condition, evidence, actor: req.user, extractedText, attachment });
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
