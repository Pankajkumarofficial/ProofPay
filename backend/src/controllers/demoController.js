import { PromiseModel, Condition, Evidence, AUDIT_ACTION } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { recalculatePromise } from '../services/proofEngine.js';
import * as paymentService from '../services/paymentService.js';
import { runAssessment } from './evidenceController.js';

/** Judge Mode's starting point. */
export const seedScenario = asyncHandler(async (req, res) => {
  const promise = await PromiseModel.create({
    title: 'E-commerce website delivery',
    description:
      'A five-page storefront with authentication, a working checkout, and a responsive layout, handed over and accepted by the client.',
    sourceText:
      "I'll pay ₹10,000 when the website is delivered, login works, the payment flow works, it's responsive on mobile, and I approve the final version.",
    purpose: 'Website development',
    outcome: 'Website delivered, working end to end, and accepted by the client.',
    amount: 10000,
    currency: 'INR',
    payer: req.user._id,
    recipient: { name: 'Rahul Verma', email: 'rahul.verma@example.com', role: 'recipient' },
    participants: [
      { user: req.user._id, name: req.user.name, email: req.user.email, role: 'payer', confirmed: true },
    ],
    deadline: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
  });

  const conditionSpecs = [
    {
      description: 'The website is delivered and reachable at a live URL',
      type: 'deliverable',
      verificationMethod: 'url_check',
      requiredEvidence: ['Deployed URL', 'Screenshot of the live site'],
      proof: {
        type: 'url',
        title: 'Live storefront',
        url: 'https://demo-storefront.proofpay.dev',
        note: 'Storefront delivered and live at the URL above; all 5 pages reachable and the catalogue renders.',
      },
    },
    {
      description: 'Login and account creation work end to end',
      type: 'test',
      verificationMethod: 'test_report',
      requiredEvidence: ['Passing test report', 'CI run link'],
      proof: {
        type: 'test_report',
        title: 'Auth suite — 24 passing',
        note: 'Login and account creation test suite: 24 tests passed, 0 failed, run on the deployed build.',
      },
    },
    {
      description: 'The payment flow completes a test transaction successfully',
      type: 'test',
      verificationMethod: 'test_report',
      requiredEvidence: ['Test transaction receipt', 'Passing checkout test report'],
      proof: {
        type: 'test_report',
        title: 'Checkout test transaction',
        note: 'Test transaction completed on the deployed payment flow: order placed, receipt issued, status settled.',
      },
    },
    {
      description: 'The layout is responsive on mobile widths',
      type: 'quality',
      verificationMethod: 'ai_assessment',
      requiredEvidence: ['Screenshots across device widths', 'Audit report'],
    },
    {
      description: 'The client approves the final version',
      type: 'approval',
      verificationMethod: 'manual_approval',
      requiredEvidence: ['Written approval from the payer'],
    },
  ];

  const conditions = await Condition.insertMany(
    conditionSpecs.map((spec, index) => ({
      promise: promise._id,
      order: index,
      label: `Condition ${String(index + 1).padStart(2, '0')}`,
      description: spec.description,
      type: spec.type,
      verificationMethod: spec.verificationMethod,
      requiredEvidence: spec.requiredEvidence,
    }))
  );

  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.PROMISE_CREATED,
    summary: `Promise created — ${promise.amount} ${promise.currency} to ${promise.recipient.name}`,
    metadata: { source: 'judge-mode', conditions: conditions.length },
  });

  const { payment } = await paymentService.createPayment({ promise, payer: req.user });
  await paymentService.verifyPayment({ payment });
  promise.fundedAt = new Date();
  await promise.save();
  await recordAudit({
    user: req.user,
    promise,
    action: AUDIT_ACTION.PROMISE_FUNDED,
    summary: `${promise.amount} ${promise.currency} held against this promise`,
  });

  // Three of the five conditions arrive already proven.
  for (const [index, spec] of conditionSpecs.entries()) {
    if (!spec.proof) continue;
    const condition = conditions[index];
    const evidence = await Evidence.create({
      promise: promise._id,
      condition: condition._id,
      submittedBy: req.user._id,
      title: spec.proof.title,
      type: spec.proof.type,
      source: spec.proof.url ? 'link' : 'note',
      url: spec.proof.url ?? null,
      note: spec.proof.note ?? '',
    });
    await recordAudit({
      user: req.user,
      promise,
      action: AUDIT_ACTION.EVIDENCE_SUBMITTED,
      summary: `Proof submitted — ${evidence.title} for ${condition.label}`,
      entity: { type: 'Evidence', id: evidence._id },
    });
    await runAssessment({ promise, condition, evidence, actor: req.user });
  }

  const result = await recalculatePromise(promise._id, { actor: req.user, reason: 'judge scenario created' });

  res.status(201).json({
    success: true,
    data: { promise: result.promise, conditions: result.conditions },
  });
});
