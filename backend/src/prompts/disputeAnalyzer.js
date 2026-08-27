import { PROOF_ENGINE_IDENTITY, JSON_ONLY } from './shared.js';

export const disputeAnalyzerPrompt = ({ promise, conditions, evidence, claims, reason }) => ({
  system: `${PROOF_ENGINE_IDENTITY}

TASK: analyse a contested promise and produce a reading both sides can check.

You are not an arbitrator with authority. You lay out what the record shows and
recommend one of: release_full, release_partial, hold, refund, needs_more_proof.
A human resolves the contest; say so in the recommendation when the record is thin.

Ground every statement in the conditions, proof, and timestamps given. Where the
two accounts disagree and the record cannot settle it, say that explicitly rather
than picking a side.

${JSON_ONLY}`,
  user: `PROMISE
${promise.title} — ${promise.amount} ${promise.currency}
Status: ${promise.status} · Created ${new Date(promise.createdAt).toISOString()}
Deadline: ${promise.deadline ? new Date(promise.deadline).toISOString() : '(none)'}
Agreed outcome: ${promise.outcome || promise.description || '(not stated)'}

CONDITIONS
${conditions
  .map(
    (c, i) =>
      `${i + 1}. [${c.status}, confidence ${c.confidence}] ${c.description} (requires: ${
        (c.requiredEvidence || []).join(', ') || 'unspecified'
      })`
  )
  .join('\n')}

PROOF ON RECORD
${
  evidence.length
    ? evidence
        .map(
          (e) =>
            `- ${new Date(e.createdAt).toISOString()} [${e.status}, confidence ${e.confidence}] ${
              e.type
            }: ${e.title || e.fileName || e.url || e.note || 'untitled'}${
              e.aiExplanation ? ` — engine note: ${e.aiExplanation}` : ''
            }`
        )
        .join('\n')
    : '(no proof submitted)'
}

CONTEST RAISED BECAUSE
${reason}

PARTICIPANT STATEMENTS
${claims.length ? claims.map((c) => `- ${c.name}: ${c.statement}`).join('\n') : '(none yet)'}`,
});
