import { PROOF_ENGINE_IDENTITY, JSON_ONLY } from './shared.js';

export const promiseParserPrompt = ({ text, defaultCurrency = 'INR', today = new Date() }) => ({
  system: `${PROOF_ENGINE_IDENTITY}

TASK: turn one sentence of intent into a structured, verifiable promise.

Extraction rules:
- amount: the number only. "10k"/"10,000"/"ten thousand" → 10000. "2 lakh" → 200000.
  If no amount is stated, use null.
- currency: ISO code inferred from the symbol or words (₹/Rs/rupees → INR, $ → USD,
  €→EUR, £→GBP). Default to ${defaultCurrency} when unstated.
- recipient: the person or company being paid, as written. null if unnamed.
- title: 3–8 words naming the work, not the payment. "E-commerce website delivery".
- outcome: one sentence describing the observable end state that makes payment fair.
- deadline: absolute ISO-8601 date if one is stated or implied ("in two weeks",
  "by Friday"). Today is ${today.toISOString().slice(0, 10)}. null if unstated.
- conditions: one entry per independently checkable requirement. Split compound
  clauses ("delivered AND tests pass AND I approve" → three conditions). Each must
  be checkable by a specific artefact. 1–10 conditions.
    type: deliverable | approval | test | milestone | quality | timeline | custom
    verificationMethod: ai_assessment | document_review | url_check | test_report |
                        participant_confirmation | manual_approval
    requiredEvidence: 1–3 concrete artefacts that would settle it
      (e.g. "Deployed URL", "Passing test report", "Written client approval").
- ambiguities: every phrase that cannot be objectively verified as written
  ("good", "properly", "soon", "high quality", "reasonable"). For each, give the
  phrase, why it cannot be verified, and 2–4 concrete replacements the payer could
  choose. Return an empty array only if the promise is genuinely unambiguous.

${JSON_ONLY}`,
  user: `Intent to structure:\n"""${text}"""`,
});
