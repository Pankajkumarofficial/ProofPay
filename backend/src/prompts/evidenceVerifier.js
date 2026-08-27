import { PROOF_ENGINE_IDENTITY, JSON_ONLY } from './shared.js';

export const evidenceVerifierPrompt = ({ promise, condition, evidence, siblingEvidence = [] }) => ({
  system: `${PROOF_ENGINE_IDENTITY}

TASK: decide whether one piece of submitted proof satisfies one specific condition.

Return exactly one verdict:
- SUPPORTS      the proof demonstrably satisfies this condition
- INSUFFICIENT  the proof is related but does not settle the condition, or you
                cannot see the artefact itself (e.g. a link you cannot open)
- CONTRADICTS   the proof indicates the condition is NOT satisfied, or conflicts
                with proof already accepted for this promise

confidence (0–100) is how certain you are of that verdict. A file name alone is
weak proof: cap confidence at 60 when the artefact's contents were not provided.
Never exceed 95 without direct, inspectable content.

explanation: 1–3 sentences, addressed to both parties, citing what in the proof
did or did not settle the condition. Name the gap when you say INSUFFICIENT.
contradictions: specific conflicts with other proof, or an empty array.
missingEvidence: what would settle it, or an empty array.

${JSON_ONLY}`,
  user: `PROMISE
Title: ${promise.title}
Amount: ${promise.amount} ${promise.currency}
Outcome that justifies payment: ${promise.outcome || promise.description || '(not stated)'}

CONDITION UNDER TEST
${condition.description}
Type: ${condition.type} · Verification method: ${condition.verificationMethod}
Evidence normally required: ${(condition.requiredEvidence || []).join(', ') || '(unspecified)'}

SUBMITTED PROOF
Type: ${evidence.type}
Source: ${evidence.source}
Title: ${evidence.title || '(untitled)'}
File: ${evidence.fileName || '(none)'} ${evidence.mimeType ? `(${evidence.mimeType})` : ''}
Link: ${evidence.url || '(none)'}
Submitted note: ${evidence.note || '(none)'}
Submitted at: ${new Date(evidence.createdAt || Date.now()).toISOString()}
${evidence.extractedText ? `\nExtracted contents:\n"""${evidence.extractedText.slice(0, 6000)}"""` : ''}

PROOF ALREADY ON RECORD FOR THIS PROMISE
${
  siblingEvidence.length
    ? siblingEvidence
        .map((e) => `- [${e.status}] ${e.type}: ${e.title || e.fileName || e.url || e.note || 'untitled'}`)
        .join('\n')
    : '(none)'
}`,
});
