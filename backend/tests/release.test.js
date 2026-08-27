import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, stopTestApp, client, fundedPromise, proveIt } from './helpers.js';

/**
 * Releasing money is the one action in ProofPay that cannot be undone by
 * pressing a button again, so these tests guard it from three directions:
 * it must happen exactly once, only when every condition is proven, and only
 * when a person says so.
 */

let base;
before(async () => {
  base = await startTestApp();
});
after(stopTestApp);

describe('fulfilment', () => {
  test('releases exactly once under concurrent requests', async () => {
    const api = client(base);
    await api.signUp();
    const { promise, conditionId } = await fundedPromise(api);
    await proveIt(api, promise._id, conditionId);

    // Ten payers hammering the button, or one payer on a flaky connection.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.call(`/promises/${promise._id}/fulfill`, { body: { confirm: true, note: 'race' } })
      )
    );

    const released = results.filter((result) => result.status === 200);
    assert.equal(released.length, 1, 'exactly one request may release the money');

    for (const rejected of results.filter((result) => result.status !== 200)) {
      assert.equal(rejected.status, 409);
    }

    // The ledger is the real check: one release, not one surviving record.
    const chronicle = await api.get(`/promises/${promise._id}/chronicle`);
    const entries = chronicle.body.data.entries ?? chronicle.body.data.chronicle ?? [];
    const releases = entries.filter((entry) => /released to/i.test(entry.summary ?? ''));
    assert.equal(releases.length, 1, 'the Chronicle must record one release');
  });

  test('refuses to release while a condition is unproven', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await fundedPromise(api);

    const result = await api.call(`/promises/${promise._id}/fulfill`, {
      body: { confirm: true, note: 'too early' },
    });

    assert.equal(result.status, 409);
    assert.match(result.body.error.message, /unproven|not ready/i);
  });

  test('refuses to release without an explicit confirmation', async () => {
    const api = client(base);
    await api.signUp();
    const { promise, conditionId } = await fundedPromise(api);
    await proveIt(api, promise._id, conditionId);

    // The Proof Engine can recommend a release; it can never supply this flag.
    const result = await api.call(`/promises/${promise._id}/fulfill`, { body: { note: 'no confirm' } });
    assert.equal(result.status, 400);
  });

  test('refuses to release someone else’s promise', async () => {
    const owner = client(base);
    await owner.signUp('Owner');
    const { promise, conditionId } = await fundedPromise(owner);
    await proveIt(owner, promise._id, conditionId);

    const stranger = client(base);
    await stranger.signUp('Stranger');
    const result = await stranger.call(`/promises/${promise._id}/fulfill`, {
      body: { confirm: true, note: 'not mine' },
    });

    assert.equal(result.status, 404, 'a promise you cannot see must not exist to you');
  });
});
