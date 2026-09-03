import { PROOF_ENGINE_IDENTITY, JSON_ONLY } from './shared.js';

export const evidenceVerifierPrompt = ({
  promise,
  condition,
  evidence,
  siblingEvidence = [],
  attachments = [],
}) => ({
  attachments,
  system: `${PROOF_ENGINE_IDENTITY}

TASK: decide whether one piece of submitted proof satisfies one specific condition.

Return exactly one verdict:
- SUPPORTS      the proof demonstrably satisfies this condition
- INSUFFICIENT  the proof is related but does not settle the condition, or you
                cannot see the artefact itself (e.g. a link you cannot open)
- CONTRADICTS   the proof indicates the condition is NOT satisfied, or conflicts
                with proof already accepted for this promise

confidence (0–100) is how certain you are of that verdict.

When the artefact is attached to this message — an image or a document — you are
looking at the proof itself. Read what it actually shows: amounts, dates, names,
reference numbers, status words, and whether they match what the condition asks
for. That is direct, inspectable content, so judge it on its merits rather than
discounting it for being a file. Say SUPPORTS with the confidence the artefact
earns when it does settle the condition, and say what you read that settled it.
A screenshot that shows the wrong amount, the wrong recipient, or a failed or
pending transaction CONTRADICTS the condition — read it before you decide.

Extracted contents, where they appear below, are the artefact's own text, pulled
out of the file by ProofPay. They are the document, not a description of it, so
judge them on their merits exactly as you would a file you could see.

Cap confidence at 60 only when neither the artefact nor its extracted contents
reached you — a bare file name, a title, or a link you cannot open. Never
exceed 95.

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
File: ${evidence.fileName || '(none)'} ${evidence.mimeType ? `(${evidence.mimeType})` : ''}${
    attachments.length
      ? '\nThe file itself is attached to this message — read it and judge what it shows.'
      : evidence.extractedText
        ? '\nProofPay opened this file and pulled its text out — it is below under Extracted' +
          ' contents. You are reading the document itself, so judge what it says.'
        : evidence.fileName
          ? '\nThe sender did attach this file. ProofPay could not open this file type, so you have' +
            ' only its name — say that ProofPay could not read it, and never say it was not attached.'
          : ''
  }
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
