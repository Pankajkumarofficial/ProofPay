import {
  PromiseModel,
  Condition,
  Evidence,
  Verification,
  Payment,
  Dispute,
  AIAnalysis,
  CONDITION_STATUS,
  EVIDENCE_STATUS,
  DISPUTE_STATUS,
  PROMISE_STATUS,
  AUDIT_ACTION,
  NOTIFICATION_TYPE,
  VERDICT,
} from '../models/index.js';
import * as localEngine from './localEngine.js';
import { isModelEngineEnabled, runStructured, activeProvider } from './aiClient.js';
import {
  promiseParserPrompt,
  ambiguityDetectorPrompt,
  evidenceVerifierPrompt,
  disputeAnalyzerPrompt,
  explanationGeneratorPrompt,
} from '../prompts/index.js';
import {
  parsedPromiseSchema,
  parsedPromiseJsonSchema,
  ambiguityReportSchema,
  ambiguityReportJsonSchema,
  evidenceAssessmentSchema,
  evidenceAssessmentJsonSchema,
  disputeReportSchema,
  disputeReportJsonSchema,
  explanationSchema,
  explanationJsonSchema,
} from '../validators/aiSchemas.js';
import { computeProofConfidence, computePromiseHealth, deriveStatus } from './scoring.js';
import { recordAudit } from './auditService.js';
import { notify, stakeholderIds } from './notificationService.js';
import { publishUpdate } from './eventBus.js';
import { logger } from '../utils/logger.js';

/* ══════════════════════════ Proof Engine calls ══════════════════════════ */

/**
 * Runs one Proof Engine judgement: a model when one is configured, the deterministic
 * engine otherwise or when the model's answer fails validation. Every attempt is
 * written to AIAnalysis, valid or not, so the Chronicle can always explain where
 * a number came from.
 */
async function judge({
  kind,
  prompt,
  schema,
  jsonSchema,
  fallback,
  effort = 'low',
  links = {},
  /**
   * Whether anyone is waiting on this answer.
   *
   * A judgement made while someone watches a spinner has to give up quickly and
   * let the deterministic engine answer. One made in the background has no such
   * deadline, so it is worth sitting out a rate-limit window or an overloaded
   * minute to get the real reading — falling back is a worse answer, not a
   * faster one, when nothing is blocked on it.
   */
  patient = false,
}) {
  const startedAt = Date.now();

  if (isModelEngineEnabled()) {
    try {
      const result = await runStructured({
        prompt,
        schema,
        jsonSchema,
        effort,
        ...(patient ? { patient: true, maxAttempts: 3, maxRateLimitWaits: 2 } : {}),
      });
      const analysis = await AIAnalysis.create({
        kind,
        ...links,
        input: prompt.user.slice(0, 4000),
        output: result.data,
        engine: result.engine,
        model: result.model,
        confidence: Number(result.data.confidence ?? result.data.clarityScore ?? 0),
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        valid: true,
      });
      return { data: result.data, engine: result.engine, model: result.model, analysisId: analysis._id };
    } catch (error) {
      logger.warn(`Proof Engine fell back to the local engine for ${kind}: ${error.message}`);
      await AIAnalysis.create({
        kind,
        ...links,
        input: prompt.user.slice(0, 4000),
        // The call failed, so there is no result to read the provider from —
        // record which one was asked, so a failed attempt is still attributable.
        engine: activeProvider(),
        latencyMs: Date.now() - startedAt,
        valid: false,
        error: error.message.slice(0, 400),
      });
    }
  }

  // The local engine's output goes through exactly the same validation gate.
  const parsed = schema.parse(fallback());
  const analysis = await AIAnalysis.create({
    kind,
    ...links,
    input: prompt.user.slice(0, 4000),
    output: parsed,
    engine: 'local-engine',
    confidence: Number(parsed.confidence ?? parsed.clarityScore ?? 0),
    latencyMs: Date.now() - startedAt,
    valid: true,
  });
  return { data: parsed, engine: 'local-engine', model: null, analysisId: analysis._id };
}

export function parseIntent({ text, currency = 'INR', user = null }) {
  return judge({
    kind: 'PROMISE_PARSE',
    prompt: promiseParserPrompt({ text, defaultCurrency: currency }),
    schema: parsedPromiseSchema,
    jsonSchema: parsedPromiseJsonSchema,
    effort: 'low',
    links: { user: user?._id ?? null },
    fallback: () => localEngine.parsePromise({ text, defaultCurrency: currency }),
  });
}

export function scanAmbiguity({ text, conditions = [], promise = null, user = null }) {
  return judge({
    kind: 'AMBIGUITY_SCAN',
    prompt: ambiguityDetectorPrompt({ text, conditions }),
    schema: ambiguityReportSchema,
    jsonSchema: ambiguityReportJsonSchema,
    effort: 'low',
    links: { user: user?._id ?? null, promise: promise?._id ?? null },
    fallback: () => localEngine.scanAmbiguity({ text, conditions }),
  });
}

export function assessEvidence({
  promise,
  condition,
  evidence,
  siblingEvidence = [],
  attachments = [],
  patient = false,
  user = null,
}) {
  return judge({
    kind: 'EVIDENCE_VERIFICATION',
    patient,
    prompt: evidenceVerifierPrompt({ promise, condition, evidence, siblingEvidence, attachments }),
    schema: evidenceAssessmentSchema,
    jsonSchema: evidenceAssessmentJsonSchema,
    effort: 'medium',
    links: {
      user: user?._id ?? null,
      promise: promise._id,
      condition: condition._id,
      evidence: evidence._id,
    },
    fallback: () => localEngine.assessEvidence({ promise, condition, evidence, siblingEvidence }),
  });
}

export function analyseDispute({ promise, conditions, evidence, claims, reason, dispute, user = null }) {
  return judge({
    kind: 'DISPUTE_ANALYSIS',
    prompt: disputeAnalyzerPrompt({ promise, conditions, evidence, claims, reason }),
    schema: disputeReportSchema,
    jsonSchema: disputeReportJsonSchema,
    effort: 'medium',
    links: {
      user: user?._id ?? null,
      promise: promise._id,
      dispute: dispute?._id ?? null,
    },
    fallback: () => localEngine.analyseDispute({ promise, conditions, evidence, claims, reason }),
  });
}

export function explainPromise({ promise, conditions, health, confidence, user = null }) {
  return judge({
    kind: 'EXPLANATION',
    prompt: explanationGeneratorPrompt({ promise, conditions, health, confidence }),
    schema: explanationSchema,
    jsonSchema: explanationJsonSchema,
    effort: 'low',
    links: { user: user?._id ?? null, promise: promise._id },
    fallback: () => localEngine.explain({ promise, conditions, health, confidence }),
  });
}

/* ═════════════════════ promise state recalculation ═════════════════════ */

/** Statuses a person set deliberately; recalculation leaves them alone. */
const MANUAL_CONDITION_STATUSES = [CONDITION_STATUS.WAIVED, CONDITION_STATUS.FAILED];

function deriveConditionState(condition, evidenceForCondition, latestVerification) {
  if (MANUAL_CONDITION_STATUSES.includes(condition.status)) {
    return { status: condition.status, confidence: condition.confidence };
  }
  if (!latestVerification) {
    return {
      status: evidenceForCondition.length ? CONDITION_STATUS.AWAITING_PROOF : CONDITION_STATUS.PENDING,
      confidence: 0,
    };
  }
  const { verdict, confidence } = latestVerification;
  if (verdict === VERDICT.CONTRADICTS) return { status: CONDITION_STATUS.CONTESTED, confidence: 0 };
  if (verdict === VERDICT.SUPPORTS && confidence >= 70) {
    return { status: CONDITION_STATUS.VERIFIED, confidence };
  }
  return {
    status: CONDITION_STATUS.VERIFYING,
    confidence: verdict === VERDICT.SUPPORTS ? confidence : Math.round(confidence * 0.5),
  };
}

/**
 * Recomputes everything derived about a promise from its records, persists the
 * result, and raises the Chronicle entries and notifications that the change
 * implies. This is the only place promise status is decided.
 */
export async function recalculatePromise(promiseId, { actor = null, reason = '' } = {}) {
  const promise = await PromiseModel.findById(promiseId);
  if (!promise) return null;

  const [conditions, evidence, verifications, payment, openDisputes] = await Promise.all([
    Condition.find({ promise: promise._id }).sort({ order: 1, createdAt: 1 }),
    Evidence.find({ promise: promise._id }).sort({ createdAt: -1 }),
    Verification.find({ promise: promise._id }).sort({ createdAt: -1 }),
    Payment.findOne({ promise: promise._id }).sort({ createdAt: -1 }),
    Dispute.countDocuments({
      promise: promise._id,
      status: { $in: [DISPUTE_STATUS.OPEN, DISPUTE_STATUS.UNDER_REVIEW] },
    }),
  ]);

  const hasOpenDispute = openDisputes > 0;

  // A participant's word settles a condition only when it runs against their own
  // interest. The recipient saying a condition is met is the person being paid
  // certifying that they should be, so it carries no weight here — their account
  // of the work belongs in the evidence trail, where the Proof Engine reads it
  // and the payer can dispute it. The API refuses to record one; this makes the
  // same true of any that already exist.
  const selfServing = (verification) =>
    verification.engine === 'participant' &&
    verification.verdict === VERDICT.SUPPORTS &&
    String(verification.performedBy) === String(promise.recipient?.user ?? '') &&
    // Unless the two sides are the same account, where there is no one else to ask.
    String(verification.performedBy) !== String(promise.payer);

  // 1. Condition states follow their most recent validation.
  const conditionUpdates = [];
  for (const condition of conditions) {
    const forCondition = evidence.filter((item) => String(item.condition) === String(condition._id));
    const latest = verifications.find(
      (item) => String(item.condition) === String(condition._id) && !selfServing(item)
    );
    const next = deriveConditionState(condition, forCondition, latest);

    if (condition.status !== next.status || condition.confidence !== next.confidence) {
      const becameVerified =
        next.status === CONDITION_STATUS.VERIFIED && condition.status !== CONDITION_STATUS.VERIFIED;
      condition.status = next.status;
      condition.confidence = next.confidence;
      if (becameVerified) condition.verifiedAt = new Date();
      conditionUpdates.push({ condition, becameVerified });
    }
  }
  await Promise.all(conditionUpdates.map(({ condition }) => condition.save()));

  // 2. Scores.
  const previous = {
    status: promise.status,
    confidence: promise.proofConfidence,
    health: promise.promiseHealth?.overall ?? 0,
  };

  const proofConfidence = computeProofConfidence({ promise, conditions, evidence, hasOpenDispute });
  const promiseHealth = computePromiseHealth({ promise, conditions, evidence, verifications });
  const status = deriveStatus({ promise, conditions, evidence, payment, hasOpenDispute });

  promise.proofConfidence = proofConfidence;
  promise.promiseHealth = promiseHealth;
  promise.status = status;
  await promise.save();

  // 3. What changed is worth telling people about.
  const stakeholders = stakeholderIds(promise);

  for (const { condition, becameVerified } of conditionUpdates) {
    if (!becameVerified) continue;
    await recordAudit({
      user: actor,
      promise,
      action: AUDIT_ACTION.CONDITION_VERIFIED,
      summary: `Condition verified — ${condition.description.slice(0, 90)}`,
      entity: { type: 'Condition', id: condition._id },
      metadata: { confidence: condition.confidence },
    });
    await notify({
      users: stakeholders,
      promise,
      type: NOTIFICATION_TYPE.CONDITION_VERIFIED,
      title: 'Condition verified',
      body: `${condition.description.slice(0, 120)} — ${condition.confidence}% Proof Confidence.`,
      severity: 'success',
    });
  }

  if (previous.status !== status) {
    await recordAudit({
      user: actor,
      promise,
      action: AUDIT_ACTION.PROMISE_STATUS_CHANGED,
      summary: `Status moved from ${previous.status} to ${status}${reason ? ` (${reason})` : ''}`,
      metadata: { from: previous.status, to: status },
    });

    if (status === PROMISE_STATUS.READY_TO_FULFILL) {
      await notify({
        users: stakeholders,
        promise,
        type: NOTIFICATION_TYPE.READY_FOR_FULFILLMENT,
        title: 'Promise ready for fulfillment',
        body: `Every condition on ${promise.title} is proven. ${promise.amount} ${promise.currency} awaits your authorisation.`,
        severity: 'success',
      });
    }
    if (status === PROMISE_STATUS.CONTESTED) {
      await notify({
        users: stakeholders,
        promise,
        type: NOTIFICATION_TYPE.PROMISE_CONTESTED,
        title: 'Promise contested',
        body: `${promise.title} is contested. The money stays conditional until the contest is resolved.`,
        severity: 'critical',
      });
    }
  }

  const healthDrop = previous.health - promiseHealth.overall;
  if (healthDrop >= 15) {
    await notify({
      users: stakeholders,
      promise,
      type: NOTIFICATION_TYPE.HEALTH_CHANGED,
      title: 'Promise Health dropped',
      body: `${promise.title} moved from ${previous.health}% to ${promiseHealth.overall}% health.`,
      severity: 'warning',
    });
  }

  publishUpdate({
    userIds: stakeholders.map(String),
    type: 'promise.updated',
    data: { promiseId: promise._id.toString(), status, proofConfidence, health: promiseHealth.overall },
  });

  return { promise, conditions, evidence, verifications, payment, hasOpenDispute };
}

/** Marks evidence with the outcome of a validation and records it. */
export async function recordVerification({
  promise,
  condition,
  evidence,
  assessment,
  engine,
  model,
  actor,
  method = 'proof_engine',
}) {
  const verification = await Verification.create({
    promise: promise._id,
    condition: condition._id,
    evidence: evidence?._id ?? null,
    method,
    verdict: assessment.verdict,
    confidence: assessment.confidence,
    explanation: assessment.explanation,
    contradictions: assessment.contradictions ?? [],
    performedBy: actor?._id ?? null,
    engine,
    model,
  });

  if (evidence) {
    evidence.status =
      assessment.verdict === VERDICT.SUPPORTS
        ? EVIDENCE_STATUS.ACCEPTED
        : assessment.verdict === VERDICT.CONTRADICTS
          ? EVIDENCE_STATUS.CONTRADICTED
          : EVIDENCE_STATUS.INSUFFICIENT;
    evidence.confidence = assessment.confidence;
    evidence.aiExplanation = assessment.explanation;
    evidence.verifiedAt = new Date();
    await evidence.save();
  }

  return verification;
}
