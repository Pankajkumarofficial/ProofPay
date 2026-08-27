import { PROOF_ENGINE_IDENTITY, JSON_ONLY } from './shared.js';

export const explanationGeneratorPrompt = ({ promise, conditions, health, confidence }) => ({
  system: `${PROOF_ENGINE_IDENTITY}

TASK: in two or three sentences, tell the payer where this promise actually stands
and the single most useful next step. Reference specific conditions by their words,
not by number alone. No praise, no filler.

Also return a headline of at most 8 words, and nextAction as one short imperative
sentence (or null when nothing is required of anyone right now).

${JSON_ONLY}`,
  user: `${promise.title} — ${promise.amount} ${promise.currency}, status ${promise.status}
Proof Confidence ${confidence}% · Promise Health ${health.overall}%
(conditions ${health.conditions}%, evidence ${health.evidence}%, timeline ${health.timeline}%, verification ${health.verification}%)
Deadline: ${promise.deadline ? new Date(promise.deadline).toISOString().slice(0, 10) : 'none'}

Conditions:
${conditions.map((c) => `- [${c.status}] ${c.description}`).join('\n')}`,
});
