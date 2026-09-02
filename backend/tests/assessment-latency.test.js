import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, stopTestApp, client, fundedPromise } from './helpers.js';
import { Evidence, Condition, EVIDENCE_STATUS, CONDITION_STATUS } from '../src/models/index.js';
import { settleAssessments } from '../src/controllers/evidenceController.js';

/**
 * Filing proof must not wait on the model.
 *
 * The Proof Engine talks to a third party that can be slow, overloaded, or
 * simply down — a 30s timeout, a retry, another 30s. That used to happen inside
 * the request, so the person who clicked "File proof" watched a spinner for as
 * long as the provider took, and the failure mode of a busy afternoon was a form
 * that looked broken.
 *
 * The waiting bought them nothing: the verdict is written to the record either
 * way and every screen refetches when the promise changes. So the response goes
 * out as soon as the proof is in the vault, and the reading happens behind it.
 *
 * These tests hold that line. The model here is deliberately slower than any
 * real one, so a regression that puts the call back on the request path cannot
 * pass by being quick.
 */

const MODEL_DELAY_MS = 3000;
/** Comfortably under the delay, comfortably over a local round trip. */
const MUST_RESPOND_WITHIN_MS = 1200;

let base;
let realFetch;

before(async () => {
  base = await startTestApp({ AI_API_KEY: 'AIzaSlowModelForLatencyTest', AI_PROVIDER: 'gemini' });

  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, init);
    await new Promise((resolve) => setTimeout(resolve, MODEL_DELAY_MS));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    verdict: 'SUPPORTS',
                    confidence: 88,
                    explanation: 'The attached report shows the work delivered as the condition requires.',
                    contradictions: [],
                    missingEvidence: [],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {},
      }),
    };
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await stopTestApp();
});

async function fileProof(api, promiseId, conditionId) {
  const startedAt = Date.now();
  const response = await api.call('/evidence', {
    body: {
      promiseId,
      conditionId,
      type: 'url',
      title: 'Signed report',
      url: 'https://example.com/deliver-the-signed-report',
      note: 'Deliver the signed report — signed and delivered as agreed.',
      autoVerify: true,
    },
  });
  return { response, elapsed: Date.now() - startedAt };
}

describe('filing proof does not wait on the Proof Engine', () => {
  test('the response comes back long before the model does', async (t) => {
    const api = client(base);
    await api.signUp();
    const { promise, conditionId } = await fundedPromise(api);

    const { response, elapsed } = await fileProof(api, promise._id, conditionId);

    t.diagnostic(`filed in ${elapsed}ms; the model takes ${MODEL_DELAY_MS}ms`);

    assert.equal(response.status, 201);
    assert.ok(
      elapsed < MUST_RESPOND_WITHIN_MS,
      `filing took ${elapsed}ms; the model alone takes ${MODEL_DELAY_MS}ms, so the reading is back on the request path`
    );

    // The verdict is not in the response, and the record says why: it is being read.
    assert.equal(response.body.data.assessment, null);
    assert.equal(response.body.data.assessing, true);
    assert.equal(response.body.data.evidence.status, EVIDENCE_STATUS.VERIFYING);

    await settleAssessments();
  });

  test('the verdict lands on the record once the model answers', async () => {
    const api = client(base);
    await api.signUp();
    const { promise, conditionId } = await fundedPromise(api);

    const { response } = await fileProof(api, promise._id, conditionId);
    await settleAssessments();

    const evidence = await Evidence.findById(response.body.data.evidence._id).lean();
    assert.equal(evidence.status, EVIDENCE_STATUS.ACCEPTED);
    assert.equal(evidence.confidence, 88);

    const condition = await Condition.findById(conditionId).lean();
    assert.equal(condition.status, CONDITION_STATUS.VERIFIED, 'a supported condition is verified');
    assert.equal(condition.confidence, 88);
  });

  test('a proof filed without asking for a reading is not left saying it is being read', async () => {
    const api = client(base);
    await api.signUp();
    const { promise, conditionId } = await fundedPromise(api);

    const response = await api.call('/evidence', {
      body: {
        promiseId: promise._id,
        conditionId,
        type: 'note',
        note: 'Filed for the record; no reading requested.',
        autoVerify: false,
      },
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.assessing, false);
    assert.equal(response.body.data.evidence.status, EVIDENCE_STATUS.SUBMITTED);
  });
});
