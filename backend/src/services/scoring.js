import {
  CONDITION_STATUS,
  EVIDENCE_STATUS,
  PAYMENT_STATUS,
  PROMISE_STATUS,
} from '../models/constants.js';
import { clamp, toScore } from '../utils/math.js';
import { payoutSettled } from './payoutService.js';

/** Proof Confidence and Promise Health. */

const HEALTH_WEIGHTS = { conditions: 0.35, verification: 0.25, evidence: 0.2, timeline: 0.2 };

/** How much a single condition contributes, 0–1, given its own record. */
export function conditionScore(condition) {
  switch (condition.status) {
    case CONDITION_STATUS.VERIFIED:
      return clamp(Math.max(condition.confidence, 70) / 100);
    case CONDITION_STATUS.WAIVED:
      return 1;
    case CONDITION_STATUS.VERIFYING:
      return clamp(condition.confidence / 100) * 0.6;
    case CONDITION_STATUS.CONTESTED:
      return clamp(condition.confidence / 100) * 0.25;
    case CONDITION_STATUS.FAILED:
      return 0;
    case CONDITION_STATUS.AWAITING_PROOF:
    case CONDITION_STATUS.PENDING:
    default:
      return 0;
  }
}

/** Proof Confidence: how strongly the record supports moving the money. */
export function computeProofConfidence({ promise, conditions, evidence, hasOpenDispute }) {
  if (!conditions.length) return 0;

  const totalWeight = conditions.reduce((sum, condition) => sum + (condition.weight || 1), 0);
  const weighted = conditions.reduce(
    (sum, condition) => sum + conditionScore(condition) * (condition.weight || 1),
    0
  );
  let score = weighted / totalWeight;

  const contradictions = evidence.filter((item) => item.status === EVIDENCE_STATUS.CONTRADICTED).length;
  score -= Math.min(0.25, contradictions * 0.1);

  const unresolvedAmbiguity = (promise.ambiguityFlags || []).filter((flag) => !flag.resolved).length;
  score -= Math.min(0.15, unresolvedAmbiguity * 0.05);

  if (conditions.some((condition) => condition.status === CONDITION_STATUS.FAILED)) {
    score = Math.min(score, 0.4);
  }
  if (hasOpenDispute) score = Math.min(score, 0.55);

  return toScore(score);
}

/** Promise Health: whether this promise is on track. */
export function computePromiseHealth({ promise, conditions, evidence, verifications, now = new Date() }) {
  const total = conditions.length;
  if (!total) {
    return { overall: 0, conditions: 0, evidence: 0, timeline: 0, verification: 0 };
  }

  const settled = conditions.filter((condition) =>
    [CONDITION_STATUS.VERIFIED, CONDITION_STATUS.WAIVED].includes(condition.status)
  ).length;
  const failed = conditions.filter((condition) => condition.status === CONDITION_STATUS.FAILED).length;

  // Conditions: how much of the promise is settled, minus what has failed.
  const conditionsScore = clamp(settled / total - (failed / total) * 0.5);

  // Evidence: does every condition have proof attached, and is that proof clean?
  const conditionsWithProof = new Set(
    evidence
      .filter((item) => item.condition && item.status !== EVIDENCE_STATUS.REJECTED)
      .map((item) => String(item.condition))
  ).size;
  const contradicted = evidence.filter((item) => item.status === EVIDENCE_STATUS.CONTRADICTED).length;
  const evidenceScore = clamp(conditionsWithProof / total - contradicted * 0.15);

  // Verification: how confident the recorded validations are, across the promise.
  const latestByCondition = new Map();
  for (const verification of verifications) {
    const key = String(verification.condition);
    if (!latestByCondition.has(key)) latestByCondition.set(key, verification);
  }
  const verificationScore = total
    ? clamp(
        [...latestByCondition.values()].reduce((sum, verification) => {
          const direction =
            verification.verdict === 'SUPPORTS' ? 1 : verification.verdict === 'CONTRADICTS' ? -1 : 0.35;
          return sum + (verification.confidence / 100) * direction;
        }, 0) / total
      )
    : 0;

  // Timeline: progress measured against elapsed time, not against the clock alone.
  const timelineScore = computeTimelineScore({ promise, settledRatio: settled / total, now });

  const overall =
    conditionsScore * HEALTH_WEIGHTS.conditions +
    verificationScore * HEALTH_WEIGHTS.verification +
    evidenceScore * HEALTH_WEIGHTS.evidence +
    timelineScore * HEALTH_WEIGHTS.timeline;

  return {
    overall: toScore(overall),
    conditions: toScore(conditionsScore),
    evidence: toScore(evidenceScore),
    timeline: toScore(timelineScore),
    verification: toScore(verificationScore),
  };
}

function computeTimelineScore({ promise, settledRatio, now }) {
  if (!promise.deadline) return 0.75; // No deadline is neither healthy nor at risk.
  const start = new Date(promise.createdAt || now).getTime();
  const end = new Date(promise.deadline).getTime();
  const current = now.getTime();

  if (end <= start) return settledRatio;
  const elapsed = (current - start) / (end - start);

  if (elapsed >= 1) {
    // Overdue: only a finished promise escapes the penalty.
    return settledRatio >= 1 ? 0.6 : clamp(0.2 * settledRatio);
  }
  // Ahead of the curve reads as healthy; behind it reads as risk.
  return clamp(0.7 + (settledRatio - elapsed) * 0.6);
}

/** The status of record. */
export function deriveStatus({ promise, conditions, evidence, payment, hasOpenDispute, now = new Date() }) {
  if (promise.status === PROMISE_STATUS.CANCELLED) return PROMISE_STATUS.CANCELLED;
  if (promise.status === PROMISE_STATUS.FULFILLED) return PROMISE_STATUS.FULFILLED;
  // A release is authorised money, not arrived money.
  if (payment?.status === PAYMENT_STATUS.RELEASED) {
    return payoutSettled(payment.payout) ? PROMISE_STATUS.FULFILLED : PROMISE_STATUS.SETTLING;
  }
  if (hasOpenDispute) return PROMISE_STATUS.CONTESTED;

  const total = conditions.length;
  const settled = conditions.filter((condition) =>
    [CONDITION_STATUS.VERIFIED, CONDITION_STATUS.WAIVED].includes(condition.status)
  ).length;
  const allSettled = total > 0 && settled === total;

  const funded = payment && [PAYMENT_STATUS.FUNDED, PAYMENT_STATUS.HELD].includes(payment.status);

  const overdue = promise.deadline && new Date(promise.deadline).getTime() < now.getTime();
  if (overdue && !allSettled) return PROMISE_STATUS.EXPIRED;

  if (!funded) return PROMISE_STATUS.DRAFT;
  if (allSettled) return PROMISE_STATUS.READY_TO_FULFILL;
  if (settled > 0) return PROMISE_STATUS.PARTIALLY_VERIFIED;
  if (evidence.length > 0) return PROMISE_STATUS.ACTIVE;
  return PROMISE_STATUS.FUNDED;
}
