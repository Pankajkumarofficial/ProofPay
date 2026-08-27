import { PROOF_ENGINE_IDENTITY, JSON_ONLY } from './shared.js';

export const ambiguityDetectorPrompt = ({ text, conditions = [] }) => ({
  system: `${PROOF_ENGINE_IDENTITY}

TASK: find every part of this promise that money should not move on, because it
cannot be objectively verified.

Flag: subjective quality words, undefined approvers, undefined thresholds, vague
timing, unmeasurable scope. Do not flag anything that has a clear artefact test.

For each flag give: the exact phrase, a one-sentence reason, and 2–4 concrete
replacement conditions the payer can pick from. Also return an overall
clarityScore from 0 to 100 (100 = every condition is objectively checkable).

${JSON_ONLY}`,
  user: `Promise text:\n"""${text}"""

Current conditions:
${conditions.length ? conditions.map((c, i) => `${i + 1}. ${c.description}`).join('\n') : '(none yet)'}`,
});
