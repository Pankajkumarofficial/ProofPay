/**
 * The evaluation set.
 *
 * Every case is labelled by hand with what a careful person would decide, so
 * both engines are scored against the same held-out answers rather than against
 * each other. Nothing here is tuned to make either engine look good — several
 * cases are ones the local engine is expected to win.
 *
 * The evidence set is the one that matters. ProofPay's central claim is that
 * money moves only when a promise is proven, which makes a false SUPPORTS —
 * accepting a claim with no artefact behind it — the expensive error. That is
 * what these labels measure.
 */

/* ── Ambiguity: phrases that cannot settle a payment ─────────────────────── */

export const ambiguityCases = [
  {
    text: 'Pay him 5000 when the work is good',
    // Vague on three axes at once: quality, currency, and who "him" is.
    shouldFlag: ['good'],
  },
  { text: 'I will pay 20000 when the website looks professional', shouldFlag: ['professional'] },
  { text: 'Pay Asha 15000 when the app is fast enough', shouldFlag: ['fast'] },
  { text: 'Release 8000 once the design is finalised properly', shouldFlag: ['properly'] },
  { text: 'Pay Ravi 12000 when he delivers soon', shouldFlag: ['soon'] },
  { text: 'I will pay 30000 when the quality is acceptable', shouldFlag: ['acceptable'] },
  { text: 'Pay 4000 when the copy reads nicely', shouldFlag: ['nicely'] },
  { text: 'Release 9000 when the work is more or less complete', shouldFlag: ['complete'] },

  // Unambiguous — flagging these is a false positive, and costs the score.
  { text: 'Pay Asha Rao 25000 INR when she pushes the signed contract PDF to the shared Drive folder', shouldFlag: [] },
  { text: 'Pay Ravi 10000 INR when the staging URL returns HTTP 200 and all 12 Cypress tests pass', shouldFlag: [] },
  { text: 'Pay Meera 5000 INR when she uploads the GST invoice numbered INV-2291', shouldFlag: [] },
  { text: 'Pay Sarah 18000 INR when the repository tag v2.0.0 is published on GitHub', shouldFlag: [] },
];

/* ── Parsing: does the sentence become a payable structure? ──────────────── */

export const parseCases = [
  {
    text: "I'll pay Rahul 10,000 rupees when he delivers the website, all five acceptance tests pass, and I approve the final version.",
    expect: { amount: 10000, currency: 'INR', recipient: /rahul/i, conditions: 3 },
  },
  {
    text: 'Pay Asha 2 lakh when the brand film is delivered in 4K and both revision rounds are approved.',
    expect: { amount: 200000, currency: 'INR', recipient: /asha/i, conditions: 2 },
  },
  {
    text: 'I will pay Meera 25k once she hands over the signed contract.',
    expect: { amount: 25000, currency: 'INR', recipient: /meera/i, conditions: 1 },
  },
  {
    text: 'Pay Sarah $1,500 when the logo files land in Drive and the client signs off.',
    expect: { amount: 1500, currency: 'USD', recipient: /sarah/i, conditions: 2 },
  },
  {
    text: 'Release ₹7,500 to Ravi Kumar after the API docs are published and the smoke tests are green.',
    expect: { amount: 7500, currency: 'INR', recipient: /ravi/i, conditions: 2 },
  },
  {
    text: 'I owe Priya 45000 for the audit once she files the report and presents it to the board.',
    expect: { amount: 45000, currency: 'INR', recipient: /priya/i, conditions: 2 },
  },
  {
    // Small amount, currency after the number — the shape that exposed a gap in
    // the rules. Kept in the set so a regression shows up as a score drop.
    text: 'I will pay Sushant 10 rupees for his honesty in returning my misplaced wallet.',
    expect: { amount: 10, currency: 'INR', recipient: /sushant/i, conditions: 1 },
  },
  {
    // Typed in a hurry: the verb is dropped, the name has lost its capital and
    // the currency word is misspelled. Nothing here is ambiguous to a person, so
    // an empty amount and an empty payee are the engine's failure, not the
    // sentence's.
    text: 'I will sushant ruppes 10 for something',
    expect: { amount: 10, currency: 'INR', recipient: /sushant/i, conditions: 1 },
  },
];

/* ── Evidence: the decision that actually moves money ────────────────────── */

const condition = (description, requiredEvidence) => ({
  description,
  type: 'deliverable',
  verificationMethod: 'ai_assessment',
  requiredEvidence,
  status: 'AWAITING_PROOF',
});

export const evidenceCases = [
  /* Claims with no artefact behind them. Accepting these is the expensive error. */
  {
    label: 'bare claim, no artefact',
    condition: condition('The checkout flow completes a test transaction', ['Passing test report']),
    evidence: { type: 'note', title: 'Done', note: 'Everything works fine, I checked it myself.' },
    expect: 'REFUSE',
  },
  {
    label: 'test claim with no report',
    condition: condition('All 24 checkout tests pass', ['Test report', 'CI run link']),
    evidence: { type: 'test_report', title: 'Suite run', note: 'Ran the checkout suite: 24 passed, 0 failed.' },
    expect: 'REFUSE',
  },
  {
    label: 'screenshot named but not inspectable',
    condition: condition('The dashboard renders on mobile widths', ['Screenshots across device widths']),
    evidence: { type: 'screenshot', title: 'IMG_2213.png', note: 'Looks fine on my phone.' },
    expect: 'REFUSE',
  },
  {
    label: 'unrelated artefact',
    condition: condition('The signed contract is returned', ['Signed PDF']),
    evidence: { type: 'url', title: 'Repo', url: 'https://github.com/example/website', note: 'Here is the code.' },
    expect: 'REFUSE',
  },
  {
    label: 'promise of future work',
    condition: condition('The brand film is delivered in 4K', ['Downloadable 4K master']),
    evidence: { type: 'note', title: 'Update', note: 'Will send the final cut by Friday, almost done.' },
    expect: 'REFUSE',
  },
  {
    label: 'payment claim with no reference',
    condition: condition('The invoice INV-2291 is settled', ['Bank reference or UTR']),
    evidence: { type: 'note', title: 'Paid', note: 'I have paid the invoice already.' },
    expect: 'REFUSE',
  },
  {
    label: 'contradicts the condition',
    condition: condition('All 12 Cypress tests pass', ['Passing test report']),
    evidence: { type: 'test_report', title: 'CI run', note: '10 of 12 tests passed, 2 failing on checkout.' },
    expect: 'REFUSE',
  },

  /* Genuine artefacts. Refusing these is the annoying error — it strands honest work. */
  {
    label: 'deployed URL for a delivery condition',
    condition: condition('The website is delivered and reachable at a live URL', ['Deployed URL']),
    evidence: {
      type: 'url',
      title: 'Live storefront',
      url: 'https://shop.example.com',
      note: 'The storefront is deployed and reachable at this URL; all five pages render.',
    },
    expect: 'ACCEPT',
  },
  {
    label: 'CI run link for a test condition',
    condition: condition('All 12 Cypress tests pass', ['Passing test report', 'CI run link']),
    evidence: {
      type: 'test_report',
      title: 'CI run #814',
      url: 'https://github.com/example/site/actions/runs/814',
      note: 'GitHub Actions run 814: 12 of 12 Cypress tests passed on commit a91f2c, logs attached.',
    },
    expect: 'ACCEPT',
  },
  {
    label: 'invoice document for a settlement condition',
    condition: condition('The GST invoice is issued', ['GST invoice PDF']),
    evidence: {
      type: 'invoice',
      title: 'INV-2291.pdf',
      note: 'GST invoice INV-2291 issued 14 Aug for 25,000 INR, GSTIN 29ABCDE1234F1Z5, attached as PDF.',
    },
    expect: 'ACCEPT',
  },
  {
    label: 'tagged release for a publish condition',
    condition: condition('Version v2.0.0 is published', ['Repository tag']),
    evidence: {
      type: 'repository',
      title: 'v2.0.0',
      url: 'https://github.com/example/sdk/releases/tag/v2.0.0',
      note: 'Tag v2.0.0 published with changelog and build artefacts attached.',
    },
    expect: 'ACCEPT',
  },
  {
    label: 'delivery confirmation with a tracking reference',
    condition: condition('The hardware is delivered to the office', ['Delivery confirmation']),
    evidence: {
      type: 'delivery_confirmation',
      title: 'BlueDart AWB 4471822910',
      note: 'Delivered 12 Aug 11:40, signed for by reception, AWB 4471822910 shows POD.',
    },
    expect: 'ACCEPT',
  },
];
