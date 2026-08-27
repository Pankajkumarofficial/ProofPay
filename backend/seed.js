/**
 * ProofPay demo data.
 *
 *   node seed.js        → wipe and rebuild the demo world
 *   node seed.js --keep → add the demo world alongside existing data
 *
 * Everything below is written to MongoDB through the same models, services and
 * scoring the running application uses. There is no fixture file, no demo branch
 * in the API, and nothing in React knows this data is seeded — a judge signs in
 * and exercises exactly the architecture a real user would.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from './src/config/db.js';
import { logger } from './src/utils/logger.js';
import {
  User,
  PromiseModel,
  Condition,
  Evidence,
  Verification,
  Payment,
  Dispute,
  Notification,
  AuditLog,
  AIAnalysis,
  AUDIT_ACTION,
  DISPUTE_STATUS,
  VERDICT,
} from './src/models/index.js';
import { recordAudit } from './src/services/auditService.js';
import { recalculatePromise } from './src/services/proofEngine.js';
import * as paymentService from './src/services/paymentService.js';
import { runAssessment } from './src/controllers/evidenceController.js';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY);
const daysAhead = (days) => new Date(Date.now() + days * DAY);

/**
 * Spreads the demo world across real calendar months so the charts have a shape.
 * Mongoose strips createdAt from its own updates, so this writes through the
 * driver's collection handle — the one place in the codebase that bypasses the
 * ODM, and only ever for seed data.
 */
async function backdate(model, id, createdAt, extra = {}) {
  await model.collection.updateOne({ _id: id }, { $set: { createdAt, ...extra } });
}

async function createUser({ name, email, password, avatar = null, authProvider = 'email', createdAt }) {
  const user = new User({ name, email, avatar, authProvider });
  if (password) await user.setPassword(password);
  user.lastLoginAt = daysAgo(1);
  await user.save();
  await backdate(User, user._id, createdAt);
  await recordAudit({ user, action: AUDIT_ACTION.USER_REGISTERED, summary: `Account created with ${authProvider}` });
  return user;
}

/**
 * Builds one promise the long way round: create, add conditions, fund, file
 * proof, let the Proof Engine judge it, then let the scoring engine decide the
 * status. Exactly the sequence the API performs for a live user.
 */
async function buildPromise({
  payer,
  recipientUser,
  recipientName,
  recipientEmail,
  title,
  description,
  sourceText,
  purpose,
  outcome,
  amount,
  currency = 'INR',
  createdAt,
  deadline,
  conditions,
  fund = true,
  fulfil = false,
  ambiguityFlags = [],
}) {
  const promise = await PromiseModel.create({
    title,
    description,
    sourceText,
    purpose,
    outcome,
    amount,
    currency,
    payer: payer._id,
    recipient: {
      user: recipientUser?._id ?? null,
      name: recipientName,
      email: recipientEmail ?? recipientUser?.email ?? null,
      role: 'recipient',
    },
    participants: [
      { user: payer._id, name: payer.name, email: payer.email, role: 'payer', confirmed: true },
      ...(recipientUser
        ? [
            {
              user: recipientUser._id,
              name: recipientUser.name,
              email: recipientUser.email,
              role: 'recipient',
              confirmed: true,
            },
          ]
        : []),
    ],
    deadline: deadline ?? null,
    ambiguityFlags,
  });
  await backdate(PromiseModel, promise._id, createdAt);

  const conditionDocs = await Condition.insertMany(
    conditions.map((condition, index) => ({
      promise: promise._id,
      order: index,
      label: `Condition ${String(index + 1).padStart(2, '0')}`,
      description: condition.description,
      type: condition.type,
      verificationMethod: condition.verificationMethod,
      requiredEvidence: condition.requiredEvidence ?? [],
      weight: condition.weight ?? 1,
    }))
  );
  for (const doc of conditionDocs) await backdate(Condition, doc._id, createdAt);

  await recordAudit({
    user: payer,
    promise,
    action: AUDIT_ACTION.PROMISE_CREATED,
    summary: `Promise created — ${amount} ${currency} to ${recipientName}`,
    metadata: { conditions: conditions.length, publicId: promise.publicId },
  });
  for (const doc of conditionDocs) {
    await recordAudit({
      user: payer,
      promise,
      action: AUDIT_ACTION.CONDITION_CREATED,
      summary: `${doc.label} — ${doc.description.slice(0, 90)}`,
      entity: { type: 'Condition', id: doc._id },
    });
  }

  let payment = null;
  if (fund) {
    const created = await paymentService.createPayment({ promise, payer });
    payment = await paymentService.verifyPayment({ payment: created.payment });
    const fundedAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
    await backdate(Payment, payment._id, createdAt, { fundedAt });
    promise.fundedAt = fundedAt;
    await promise.save();
    await recordAudit({
      user: payer,
      promise,
      action: AUDIT_ACTION.PROMISE_FUNDED,
      summary: `${amount} ${currency} held against this promise`,
      entity: { type: 'Payment', id: payment._id },
    });
  }

  // Proof, filed by whoever is actually doing the work.
  for (const [index, spec] of conditions.entries()) {
    const condition = conditionDocs[index];
    const submitter = spec.submittedBy === 'payer' ? payer : (recipientUser ?? payer);

    if (spec.proof) {
      const filedAt = spec.proof.daysAfter
        ? new Date(createdAt.getTime() + spec.proof.daysAfter * DAY)
        : new Date(createdAt.getTime() + DAY);

      const evidence = await Evidence.create({
        promise: promise._id,
        condition: condition._id,
        submittedBy: submitter._id,
        title: spec.proof.title,
        type: spec.proof.type,
        source: spec.proof.url ? 'link' : 'note',
        url: spec.proof.url ?? null,
        note: spec.proof.note ?? '',
      });
      await backdate(Evidence, evidence._id, filedAt);
      await recordAudit({
        user: submitter,
        promise,
        action: AUDIT_ACTION.EVIDENCE_SUBMITTED,
        summary: `Proof submitted — ${evidence.title} for ${condition.label}`,
        entity: { type: 'Evidence', id: evidence._id },
      });
      await runAssessment({ promise, condition, evidence, actor: submitter });
    }

    if (spec.confirmedBy) {
      const confirmer = spec.confirmedBy === 'payer' ? payer : (recipientUser ?? payer);
      const verification = await Verification.create({
        promise: promise._id,
        condition: condition._id,
        method: 'participant',
        verdict: spec.confirmedBy === 'reject' ? VERDICT.CONTRADICTS : VERDICT.SUPPORTS,
        confidence: spec.confirmedBy === 'reject' ? 0 : 100,
        explanation: `${confirmer.name} confirmed this condition is satisfied.`,
        performedBy: confirmer._id,
        engine: 'participant',
      });
      await backdate(Verification, verification._id, new Date(createdAt.getTime() + 2 * DAY));
      await recordAudit({
        user: confirmer,
        promise,
        action: AUDIT_ACTION.CONDITION_VERIFIED,
        summary: `${confirmer.name} confirmed ${condition.label}`,
        entity: { type: 'Condition', id: condition._id },
      });
    }
  }

  const result = await recalculatePromise(promise._id, { actor: payer, reason: 'seeded' });

  if (fulfil && payment) {
    const released = await paymentService.releasePayment({ payment, authorisedBy: payer });
    const releasedAt = new Date(createdAt.getTime() + 6 * DAY);
    await backdate(Payment, released._id, createdAt, { releasedAt });
    result.promise.status = 'FULFILLED';
    result.promise.fulfilledAt = releasedAt;
    await result.promise.save();
    await recordAudit({
      user: payer,
      promise: result.promise,
      action: AUDIT_ACTION.PAYMENT_RELEASED,
      summary: `${amount} ${currency} released to ${recipientName}`,
    });
    await recordAudit({
      user: payer,
      promise: result.promise,
      action: AUDIT_ACTION.PROMISE_FULFILLED,
      summary: 'Promise fulfilled — every condition proven',
    });
  }

  return { promise: result.promise, conditions: result.conditions };
}

async function seed() {
  const keep = process.argv.includes('--keep');
  await connectDatabase();

  if (!keep) {
    logger.warn('Clearing existing ProofPay collections…');
    await Promise.all(
      [User, PromiseModel, Condition, Evidence, Verification, Payment, Dispute, Notification, AuditLog, AIAnalysis].map(
        (model) => model.deleteMany({})
      )
    );
  }

  logger.info('Creating people…');
  const ananya = await createUser({
    name: 'Ananya Rao',
    email: 'demo@proofpay.app',
    password: 'proofpay123',
    createdAt: daysAgo(150),
  });
  const rahul = await createUser({
    name: 'Rahul Verma',
    email: 'rahul@proofpay.app',
    password: 'proofpay123',
    createdAt: daysAgo(140),
  });
  const sarah = await createUser({
    name: 'Sarah Mathews',
    email: 'sarah@proofpay.app',
    password: 'proofpay123',
    createdAt: daysAgo(120),
  });
  const meera = await createUser({
    name: 'Meera Nair',
    email: 'meera@proofpay.app',
    password: 'proofpay123',
    createdAt: daysAgo(96),
  });

  logger.info('Building promises…');

  // 1 — the flagship scenario: partly proven, two live steps left for a judge.
  await buildPromise({
    payer: ananya,
    recipientUser: rahul,
    recipientName: 'Rahul Verma',
    title: 'E-commerce website delivery',
    description:
      'A five-page storefront with authentication, a working checkout and a responsive layout, handed over and accepted by the client.',
    sourceText:
      "I'll pay Rahul ₹10,000 when he delivers the website, login works, the payment flow works, it's responsive on mobile, and I approve the final version.",
    purpose: 'Website development',
    outcome: 'Website delivered, working end to end, and accepted by the client.',
    amount: 10000,
    createdAt: daysAgo(9),
    deadline: daysAhead(6),
    conditions: [
      {
        description: 'The website is delivered and reachable at a live URL',
        type: 'deliverable',
        verificationMethod: 'url_check',
        requiredEvidence: ['Deployed URL', 'Screenshot of the live site'],
        proof: {
          type: 'url',
          title: 'Live storefront',
          url: 'https://demo-storefront.proofpay.dev',
          note: 'Storefront delivered and live at the URL above; all five pages reachable.',
          daysAfter: 3,
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
          note: 'Login and account creation test report: 24 tests passed, 0 failed, executed against the deployed build.',
          daysAfter: 4,
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
          note: 'Test transaction completed on the deployed payment flow: order placed, receipt issued, settlement status confirmed.',
          daysAfter: 5,
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
    ],
  });

  // 2 — a bigger promise, mid-flight.
  await buildPromise({
    payer: ananya,
    recipientUser: sarah,
    recipientName: 'Sarah Mathews',
    title: 'Brand film production',
    description: 'A 90-second brand film: script, shoot, edit, two revision rounds, delivered in 4K.',
    sourceText:
      'Pay Sarah ₹35,000 when she delivers the brand film in 4K and both revision rounds are approved.',
    purpose: 'Video production',
    outcome: 'Final 4K film delivered and both revision rounds signed off.',
    amount: 35000,
    createdAt: daysAgo(21),
    deadline: daysAhead(11),
    conditions: [
      {
        description: 'The final cut is delivered in 4K',
        type: 'deliverable',
        verificationMethod: 'url_check',
        requiredEvidence: ['Delivery link to the master file'],
        proof: {
          type: 'url',
          title: 'Master file — 4K delivery link',
          url: 'https://files.proofpay.dev/brand-film-master-4k',
          note: 'Final cut delivered in 4K at the link above, with the project file attached.',
          daysAfter: 12,
        },
      },
      {
        description: 'Revision round one is approved by the client',
        type: 'approval',
        verificationMethod: 'participant_confirmation',
        requiredEvidence: ['Written approval from the payer'],
        confirmedBy: 'payer',
      },
      {
        description: 'Revision round two is approved by the client',
        type: 'approval',
        verificationMethod: 'participant_confirmation',
        requiredEvidence: ['Written approval from the payer'],
      },
    ],
  });

  // 3 — everything proven, money released.
  await buildPromise({
    payer: ananya,
    recipientUser: meera,
    recipientName: 'Meera Nair',
    title: 'Identity system redesign',
    description: 'Wordmark, palette, type scale and a one-page usage guide.',
    sourceText: 'Pay Meera ₹18,000 when the identity files are handed over and I approve the usage guide.',
    purpose: 'Brand identity',
    outcome: 'Identity files handed over and the usage guide approved.',
    amount: 18000,
    createdAt: daysAgo(62),
    deadline: daysAgo(48),
    fulfil: true,
    conditions: [
      {
        description: 'Source files are handed over in editable formats',
        type: 'deliverable',
        verificationMethod: 'document_review',
        requiredEvidence: ['Delivery confirmation', 'Archive of source files'],
        proof: {
          type: 'delivery_confirmation',
          title: 'Identity source files handed over',
          note: 'Editable source files handed over: wordmark, palette tokens, type scale and export set.',
          daysAfter: 4,
        },
      },
      {
        description: 'The client approves the usage guide',
        type: 'approval',
        verificationMethod: 'participant_confirmation',
        requiredEvidence: ['Written approval from the payer'],
        confirmedBy: 'payer',
      },
    ],
  });

  // 4 — proven and funded, waiting on a human to authorise fulfillment.
  const contentPack = await buildPromise({
    payer: ananya,
    recipientUser: rahul,
    recipientName: 'Rahul Verma',
    title: 'Quarterly content pack',
    description: 'Twelve long-form articles with sources, delivered as a single publishable pack.',
    sourceText: 'Pay Rahul ₹12,500 when all twelve articles are delivered and the editor signs off.',
    purpose: 'Content production',
    outcome: 'Twelve articles delivered and approved by the editor.',
    amount: 12500,
    createdAt: daysAgo(34),
    deadline: daysAhead(4),
    conditions: [
      {
        description: 'All twelve articles are delivered with sources',
        type: 'deliverable',
        verificationMethod: 'document_review',
        requiredEvidence: ['Delivery confirmation', 'Article index'],
        proof: {
          type: 'delivery_confirmation',
          title: 'Twelve articles delivered with sources',
          note: 'All twelve articles delivered with an index and source list attached for each piece.',
          daysAfter: 20,
        },
      },
      {
        description: 'The editor signs off on the pack',
        type: 'approval',
        verificationMethod: 'participant_confirmation',
        requiredEvidence: ['Written approval from the payer'],
        confirmedBy: 'payer',
      },
    ],
  });

  // 5 — funded, nothing proven yet.
  await buildPromise({
    payer: ananya,
    recipientUser: sarah,
    recipientName: 'Sarah Mathews',
    title: 'Mobile app — phase one',
    description: 'Onboarding, home feed and profile, built against the agreed designs.',
    sourceText:
      'Pay Sarah ₹48,000 when phase one is delivered, the test suite passes and the build ships to TestFlight.',
    purpose: 'Mobile development',
    outcome: 'Phase one shipped to TestFlight with a passing test suite.',
    amount: 48000,
    createdAt: daysAgo(5),
    deadline: daysAhead(24),
    conditions: [
      {
        description: 'Phase one screens are delivered against the agreed designs',
        type: 'deliverable',
        verificationMethod: 'ai_assessment',
        requiredEvidence: ['Build link', 'Screenshots of each screen'],
      },
      {
        description: 'The automated test suite passes on the release build',
        type: 'test',
        verificationMethod: 'test_report',
        requiredEvidence: ['Passing test report'],
      },
      {
        description: 'The build is available on TestFlight',
        type: 'milestone',
        verificationMethod: 'url_check',
        requiredEvidence: ['TestFlight link'],
      },
    ],
  });

  // 6 — contested: proof on record conflicts with what the payer sees.
  const audit = await buildPromise({
    payer: ananya,
    recipientUser: meera,
    recipientName: 'Meera Nair',
    title: 'Data migration audit',
    description: 'Full audit of the migrated records with a written reconciliation report.',
    sourceText: 'Pay Meera ₹7,500 when the migration audit is complete and the reconciliation report is delivered.',
    purpose: 'Data audit',
    outcome: 'Migration audited and reconciled with a written report.',
    amount: 7500,
    createdAt: daysAgo(27),
    deadline: daysAhead(2),
    conditions: [
      {
        description: 'Every migrated record is reconciled against the source system',
        type: 'deliverable',
        verificationMethod: 'document_review',
        requiredEvidence: ['Reconciliation report', 'Record counts from both systems'],
        proof: {
          type: 'note',
          title: 'Reconciliation status',
          note: 'Reconciliation is incomplete: 1,284 records failed to match and the export for those is missing.',
          daysAfter: 18,
        },
      },
      {
        description: 'A written reconciliation report is delivered',
        type: 'deliverable',
        verificationMethod: 'document_review',
        requiredEvidence: ['Reconciliation report PDF'],
      },
    ],
  });

  const dispute = await Dispute.create({
    promise: audit.promise._id,
    raisedBy: ananya._id,
    reason:
      'The reconciliation report has not been delivered, and the status note on record says 1,284 records still fail to match.',
    contestedConditions: audit.conditions.map((condition) => condition._id),
    status: DISPUTE_STATUS.OPEN,
    claims: [
      {
        user: ananya._id,
        name: ananya.name,
        statement: 'I cannot accept the audit as complete while a fifth of the records are unmatched.',
      },
      {
        user: meera._id,
        name: meera.name,
        statement:
          'The unmatched records come from a source export that was never provided to me. The audit itself is finished for everything I was given.',
      },
    ],
  });
  await backdate(Dispute, dispute._id, daysAgo(3));
  await Condition.updateMany({ promise: audit.promise._id }, { $set: { status: 'CONTESTED' } });
  await recordAudit({
    user: ananya,
    promise: audit.promise,
    action: AUDIT_ACTION.DISPUTE_OPENED,
    summary: `Contest opened — ${dispute.reason.slice(0, 90)}`,
    entity: { type: 'Dispute', id: dispute._id },
  });
  await recalculatePromise(audit.promise._id, { actor: ananya, reason: 'contested' });

  // 7 — a draft that has never been funded.
  await buildPromise({
    payer: ananya,
    recipientName: 'Kabir Shah',
    recipientEmail: 'kabir.shah@example.com',
    title: 'Landing page copy',
    description: 'Hero, three sections and a closing call to action.',
    sourceText: "I'll pay ₹5,000 for the landing page copy once it reads well.",
    purpose: 'Copywriting',
    outcome: 'Landing page copy delivered and approved.',
    amount: 5000,
    createdAt: daysAgo(2),
    deadline: daysAhead(12),
    fund: false,
    ambiguityFlags: [
      {
        phrase: 'reads well',
        reason: '"reads well" has no artefact that settles it, so the Proof Engine cannot objectively decide when it is met.',
        suggestions: ['Written client approval', 'Acceptance checklist signed off', 'Custom condition'],
        resolved: false,
      },
    ],
    conditions: [
      {
        description: 'Copy for the hero and three sections is delivered',
        type: 'deliverable',
        verificationMethod: 'document_review',
        requiredEvidence: ['Delivered document'],
      },
      {
        description: 'The client approves the final copy',
        type: 'approval',
        verificationMethod: 'manual_approval',
        requiredEvidence: ['Written approval from the payer'],
      },
    ],
  });

  // 8 — the deadline passed with work outstanding.
  await buildPromise({
    payer: ananya,
    recipientUser: rahul,
    recipientName: 'Rahul Verma',
    title: 'Analytics dashboard embed',
    description: 'Embed the analytics dashboard with role-based access.',
    sourceText: 'Pay Rahul ₹9,000 when the analytics embed is live with role-based access.',
    purpose: 'Engineering',
    outcome: 'Analytics dashboard embedded with role-based access.',
    amount: 9000,
    createdAt: daysAgo(46),
    deadline: daysAgo(4),
    conditions: [
      {
        description: 'The dashboard is embedded and reachable in the product',
        type: 'deliverable',
        verificationMethod: 'url_check',
        requiredEvidence: ['Link to the embedded dashboard'],
      },
      {
        description: 'Role-based access restricts the embed correctly',
        type: 'test',
        verificationMethod: 'test_report',
        requiredEvidence: ['Access-control test report'],
      },
    ],
  });

  // 9 — the demo user on the receiving end, so both roles are represented.
  await buildPromise({
    payer: rahul,
    recipientUser: ananya,
    recipientName: 'Ananya Rao',
    title: 'API integration review',
    description: 'A written review of the payments integration with prioritised findings.',
    sourceText: 'Pay Ananya ₹15,000 when the integration review is delivered with prioritised findings.',
    purpose: 'Technical review',
    outcome: 'Integration review delivered with prioritised findings.',
    amount: 15000,
    createdAt: daysAgo(13),
    deadline: daysAhead(8),
    conditions: [
      {
        description: 'A written review with prioritised findings is delivered',
        type: 'deliverable',
        verificationMethod: 'document_review',
        requiredEvidence: ['Review document'],
        proof: {
          type: 'document',
          title: 'Integration review — 14 findings',
          note: 'Written review delivered covering the payments integration, with 14 prioritised findings and suggested fixes.',
          daysAfter: 8,
        },
      },
      {
        description: 'A walkthrough call covering the findings takes place',
        type: 'milestone',
        verificationMethod: 'participant_confirmation',
        requiredEvidence: ['Confirmation from both sides'],
      },
    ],
  });

  const [users, promises, conditions, evidence, payments, notifications, chronicle, analyses] = await Promise.all([
    User.countDocuments(),
    PromiseModel.countDocuments(),
    Condition.countDocuments(),
    Evidence.countDocuments(),
    Payment.countDocuments(),
    Notification.countDocuments(),
    AuditLog.countDocuments(),
    AIAnalysis.countDocuments(),
  ]);

  const statuses = await PromiseModel.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } },
    { $sort: { count: -1 } },
  ]);

  logger.info('─────────────────────────────────────────────');
  logger.info(`Users ${users} · Promises ${promises} · Conditions ${conditions}`);
  logger.info(`Proof ${evidence} · Payments ${payments} · Notifications ${notifications}`);
  logger.info(`Chronicle entries ${chronicle} · Proof Engine analyses ${analyses}`);
  logger.info('Promise states:');
  for (const row of statuses) logger.info(`  ${row._id.padEnd(20)} ${row.count} · ${row.value}`);
  logger.info('─────────────────────────────────────────────');
  logger.info('Sign in as  demo@proofpay.app  /  proofpay123');
  logger.info('Also seeded: rahul@ · sarah@ · meera@proofpay.app (same password)');

  await disconnectDatabase();
  await mongoose.connection.close().catch(() => {});
  process.exit(0);
}

seed().catch(async (error) => {
  logger.error('Seed failed:', error.message);
  logger.error(error.stack);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
