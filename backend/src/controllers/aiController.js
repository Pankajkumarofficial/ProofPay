import { Evidence, Condition, Dispute } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parseIntent, scanAmbiguity, analyseDispute } from '../services/proofEngine.js';
import { runAssessment } from './evidenceController.js';
import { recalculatePromise } from '../services/proofEngine.js';
import { loadPromiseForUser } from './helpers.js';
import { env } from '../config/env.js';

/**
 * Turns a sentence into a promise draft. This endpoint deliberately does not
 * write anything: the payer reviews and edits the draft, then POSTs /api/promises.
 */
export const parsePromise = asyncHandler(async (req, res) => {
  const { text, currency } = req.body;
  const result = await parseIntent({ text, currency, user: req.user });

  const draft = result.data;
  res.json({
    success: true,
    data: {
      draft: {
        ...draft,
        // The parser may legitimately find no amount; the UI asks for it rather
        // than inventing one.
        amount: draft.amount ?? null,
        deadline: draft.deadline ? new Date(draft.deadline).toISOString() : null,
        conditions: draft.conditions.map((condition, index) => ({
          ...condition,
          label: `Condition ${String(index + 1).padStart(2, '0')}`,
          weight: 1,
        })),
      },
      engine: result.engine,
      model: result.model,
      needsResolution: draft.ambiguities.length > 0,
    },
  });
});

export const detectAmbiguity = asyncHandler(async (req, res) => {
  const { text } = req.body;
  const conditions = Array.isArray(req.body.conditions) ? req.body.conditions : [];
  const result = await scanAmbiguity({ text, conditions, user: req.user });
  res.json({ success: true, data: { ...result.data, engine: result.engine, model: result.model } });
});

export const analyzeEvidence = asyncHandler(async (req, res) => {
  const evidence = await Evidence.findById(req.body.evidenceId);
  if (!evidence) throw ApiError.notFound('That proof is no longer in the vault.');

  const promise = await loadPromiseForUser(evidence.promise, req.user);
  const conditionId = req.body.conditionId ?? evidence.condition;
  if (!conditionId) throw ApiError.badRequest('File this proof against a condition first.');

  const condition = await Condition.findOne({ _id: conditionId, promise: promise._id });
  if (!condition) throw ApiError.badRequest('That condition does not belong to this promise.');

  const assessment = await runAssessment({ promise, condition, evidence, actor: req.user });
  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'proof assessed' });

  res.json({ success: true, data: { assessment, promise: result.promise, conditions: result.conditions } });
});

export const analyzeDispute = asyncHandler(async (req, res) => {
  const dispute = await Dispute.findById(req.body.disputeId);
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

  dispute.analysis = { ...result.data, analysedAt: new Date(), engine: result.engine };
  await dispute.save();

  res.json({ success: true, data: { analysis: { ...result.data, engine: result.engine } } });
});

/** Lets the UI say which engine is answering, instead of implying a model. */
export const engineStatus = (_req, res) => {
  res.json({
    success: true,
    data: {
      engine: env.ai.enabled ? 'claude' : 'local-engine',
      model: env.ai.enabled ? env.ai.model : null,
      capabilities: [
        'promise parsing',
        'ambiguity detection',
        'evidence validation',
        'contest analysis',
        'confidence scoring',
      ],
    },
  });
};
