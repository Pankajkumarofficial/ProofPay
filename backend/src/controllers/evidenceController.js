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
import { extractDocxText, extractXlsxText } from '../utils/ooxml.js';
import { storeUpload, loadStoredFile, discardStoredFile } from '../services/fileService.js';
import { loadPromiseForUser } from './helpers.js';

/** Text-shaped proof is read so the engine can judge contents, not file names. */
const READABLE = ['text/plain', 'text/csv', 'application/json', 'text/markdown'];

/** Office files are ZIPs of XML, so they are neither readable as text nor viewable as an image. */
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Proof that has to be looked at rather than read. */
const VIEWABLE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

/** Above this, sending the file costs more than the reading is worth. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** A PDF's words, pulled out here rather than left to the provider. */
async function readPdfText(bytes) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return typeof text === 'string' ? text.trim() : null;
}

/** Both readers below take `{ buffer, mimetype }` rather than an uploaded file. */
async function readTextEvidence(artefact) {
  if (!artefact?.buffer) return null;
  const { buffer, mimetype } = artefact;
  const isPdf = mimetype === 'application/pdf';
  const isOffice = mimetype === DOCX || mimetype === XLSX;
  if (!isPdf && !isOffice && !READABLE.includes(mimetype)) return null;
  try {
    const contents = isPdf
      ? await readPdfText(buffer)
      : isOffice
        ? (mimetype === DOCX ? extractDocxText : extractXlsxText)(buffer)
        : buffer.toString('utf8');
    // A scanned page extracts to nothing.
    return contents ? contents.slice(0, 20000) : null;
  } catch {
    return null;
  }
}

/** The uploaded artefact as bytes the engine can look at, or null if it cannot. */
async function readViewableEvidence(artefact) {
  if (!artefact?.buffer || !VIEWABLE.includes(artefact.mimetype)) return null;
  if (artefact.buffer.byteLength > MAX_ATTACHMENT_BYTES) return null;
  return { mimeType: artefact.mimetype, data: artefact.buffer.toString('base64') };
}

/** The artefact behind a saved Evidence record, fetched back for a re-read. */
async function storedArtefact(evidence) {
  const stored = await loadStoredFile(evidence.fileUrl);
  if (!stored) return null;
  return { buffer: stored.buffer, mimetype: evidence.mimeType || stored.contentType };
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

/** Submits proof. */
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

  const artefact = file ? { buffer: file.buffer, mimetype: file.mimetype } : null;
  const extractedText = await readTextEvidence(artefact);
  const attachment = await readViewableEvidence(artefact);
  const stored = await storeUpload(file, req.user._id);

  const evidence = await Evidence.create({
    promise: promise._id,
    condition: condition?._id ?? null,
    submittedBy: req.user._id,
    title: body.title || file?.originalname || body.url || 'Written statement',
    type: body.type,
    source: file ? 'upload' : body.url ? 'link' : body.source || 'note',
    fileUrl: stored ? stored.publicPath() : null,
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
    // Marked before the response so the vault shows "being read" immediately.
    evidence.status = EVIDENCE_STATUS.VERIFYING;
    await evidence.save();
  }

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'proof submitted' });

  res.status(201).json({
    success: true,
    data: {
      evidence: await Evidence.findById(evidence._id).populate('submittedBy', 'name avatar').lean(),
      // The reading happens after this response; the verdict arrives over the event stream.
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

/** Assessments still running behind a response that has already been sent. */
const inFlight = new Set();

/** Resolves once every background assessment started so far has settled. */
export const settleAssessments = () => Promise.allSettled([...inFlight]);

/** Reads the proof after the response has gone out. */
function assessInBackground({ promise, condition, evidence, actor, extractedText, attachment }) {
  const stakeholders = stakeholderIds(promise).map(String);

  // Deliberately not awaited by the request.
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

      // A nudge carrying the verdict.
      publishUpdate({
        userIds: stakeholders,
        type: 'evidence.assessed',
        data: {
          promiseId: String(promise._id),
          evidenceId: String(evidence._id),
          conditionId: String(condition._id),
          // Both sides' screens refresh.
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
      // Leaving it VERIFYING would strand the row forever.
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

  const artefact = await storedArtefact(evidence);
  const extractedText = await readTextEvidence(artefact);
  const attachment = await readViewableEvidence(artefact);

  // Re-reading is the same wait as the first read, so it is handled the same way.
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
  // Withdrawn proof used to leave its file behind as litter on a disk nobody swept.
  await discardStoredFile(evidence.fileUrl);
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
