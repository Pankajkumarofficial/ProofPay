import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, stopTestApp, client } from './helpers.js';
import { Verification, PromiseModel, VERDICT } from '../src/models/index.js';

/**
 * Who is allowed to say a condition is met.
 *
 * A participant's confirmation is only worth something when it runs against
 * their own interest. The payer saying a condition is satisfied is them
 * agreeing to part with their money. The recipient saying the same is the
 * person being paid certifying that they should be — a claim, not proof.
 *
 * The rule is enforced here rather than by hiding a button, because the button
 * is not what the API answers to.
 */

let base;
before(async () => {
  base = await startTestApp();
});
after(stopTestApp);

/** A promise whose recipient is a real, signed-up ProofPay account. */
async function promiseBetween() {
  const recipient = client(base);
  const recipientEmail = await recipient.signUp('Aman Rohilla');

  const payer = client(base);
  await payer.signUp('Pankaj Kumar');
  const created = await payer.call('/promises', {
    body: {
      title: 'Reward payment to Aman',
      amount: 500,
      recipient: { name: 'Aman Rohilla', email: recipientEmail },
      conditions: [{ description: 'Payer approves the release of the reward', type: 'approval' }],
    },
  });

  const promise = created.body.data.promise;
  const conditions = await payer.get(`/promises/${promise._id}/conditions`);
  return { payer, recipient, promise, conditionId: conditions.body.data.conditions[0]._id };
}

describe('writing a promise', () => {
  test('a promise cannot be written without the recipient’s email', async () => {
    // It is the only thing that ties a promise to the person on the other side:
    // without it they never see it, cannot file proof, and cannot contest it.
    const api = client(base);
    await api.signUp();

    const result = await api.call('/promises', {
      body: {
        title: 'Reward payment',
        amount: 500,
        recipient: { name: 'Aman Rohilla' },
        conditions: [{ description: 'Deliver the signed report', type: 'deliverable' }],
      },
    });

    assert.equal(result.status, 400);
    assert.match(result.body.error.message, /email/i);
  });

  test('an email that is not an email is refused too', async () => {
    const api = client(base);
    await api.signUp();

    const result = await api.call('/promises', {
      body: {
        title: 'Reward payment',
        amount: 500,
        recipient: { name: 'Aman Rohilla', email: 'aman-at-example' },
        conditions: [{ description: 'Deliver the signed report', type: 'deliverable' }],
      },
    });

    assert.equal(result.status, 400);
  });
});

describe('confirming a condition', () => {
  test('the recipient cannot confirm their own condition', async () => {
    const { recipient, conditionId, promise } = await promiseBetween();

    const result = await recipient.call(`/conditions/${conditionId}/confirm`, {
      body: { approve: true },
    });

    assert.equal(result.status, 403);
    assert.match(result.body.error.message, /payer/i);

    // And nothing about the promise moved on the strength of it.
    const after = await recipient.get(`/promises/${promise._id}`);
    const condition = after.body.data.conditions[0];
    assert.equal(condition.status, 'PENDING');
    assert.equal(condition.confidence, 0);
  });

  test('the recipient can say a condition is not met — that one costs them', async () => {
    const { recipient, conditionId, promise } = await promiseBetween();

    const result = await recipient.call(`/conditions/${conditionId}/confirm`, {
      body: { approve: false },
    });

    assert.equal(result.status, 200);
    const after = await recipient.get(`/promises/${promise._id}`);
    assert.equal(after.body.data.conditions[0].status, 'CONTESTED');
  });

  test('the payer confirming verifies it', async () => {
    const { payer, conditionId, promise } = await promiseBetween();

    const result = await payer.call(`/conditions/${conditionId}/confirm`, {
      body: { approve: true, note: 'Happy with this' },
    });

    assert.equal(result.status, 200);
    const after = await payer.get(`/promises/${promise._id}`);
    const condition = after.body.data.conditions[0];
    assert.equal(condition.status, 'VERIFIED');
    assert.equal(condition.confidence, 100);
  });

  test('the two sides are told apart in what the API offers them', async () => {
    const { payer, recipient, promise } = await promiseBetween();

    const asPayer = await payer.get(`/promises/${promise._id}`);
    assert.equal(asPayer.body.data.permissions.canConfirmConditions, true);
    assert.equal(asPayer.body.data.permissions.canFlagConditions, true);

    const asRecipient = await recipient.get(`/promises/${promise._id}`);
    assert.equal(asRecipient.body.data.permissions.canConfirmConditions, false);
    assert.equal(asRecipient.body.data.permissions.canFlagConditions, true);
  });

  test('a self-serving confirmation already on record still does not verify', async () => {
    // The API refuses to write one, but records from before that rule exist, and
    // a promise must not read as proven on the strength of one.
    const { payer, recipient, promise, conditionId } = await promiseBetween();
    const stored = await PromiseModel.findById(promise._id);

    await Verification.create({
      promise: promise._id,
      condition: conditionId,
      method: 'participant',
      verdict: VERDICT.SUPPORTS,
      confidence: 100,
      explanation: 'Aman Rohilla confirmed this condition is satisfied.',
      performedBy: stored.recipient.user,
      engine: 'participant',
    });

    // Any write recalculates the promise; this is the payer touching the wording.
    await payer.call(`/conditions/${conditionId}`, {
      method: 'PATCH',
      body: { description: 'Payer approves the release of the reward payment' },
    });

    const after = await recipient.get(`/promises/${promise._id}`);
    assert.equal(after.body.data.conditions[0].status, 'PENDING');
    assert.equal(after.body.data.conditions[0].confidence, 0);
  });

  test('a stranger cannot speak to a condition at all', async () => {
    const { conditionId } = await promiseBetween();

    const stranger = client(base);
    await stranger.signUp('Stranger');
    const result = await stranger.call(`/conditions/${conditionId}/confirm`, {
      body: { approve: false },
    });

    assert.equal(result.status, 404, 'a promise you cannot see must not exist to you');
  });
});
