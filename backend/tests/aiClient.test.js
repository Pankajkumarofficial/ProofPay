import test, { before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

/**
 * What the Proof Engine does when the model does not answer.
 *
 * A free-tier model is unavailable often — overloaded, rate limited, slow — and
 * ProofPay is built to shrug and let the deterministic engine answer, labelled.
 * These tests hold the line between the two kinds of failure that look alike in
 * a log and are nothing alike in what they deserve:
 *
 *   a bad answer  — retry, and tell the model what was wrong with it.
 *   no answer     — there is nothing to correct. Do not lecture a model that
 *                   never spoke, and do not make the person wait twice.
 */

// env.js reads process.env once at import, so the key goes in before it loads.
process.env.AI_API_KEY = 'AIzaTestKeyForTheProofEngine';
process.env.AI_PROVIDER = 'gemini';
const { runStructured } = await import('../src/services/aiClient.js');

const schema = z.object({ verdict: z.string() });
const prompt = { system: 'You are the Proof Engine.', user: 'Read this promise.' };

const call = () =>
  runStructured({ prompt, schema, jsonSchema: { type: 'object' }, maxAttempts: 2 });

/** The shape Gemini answers in, carrying whatever text is given. */
const geminiSays = (text) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }),
});

const httpFailure = (status, message) => ({
  ok: false,
  status,
  json: async () => ({ error: { message } }),
});

let realFetch;
let requests;

before(() => {
  realFetch = globalThis.fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  requests = [];
});

/** Answers each call from `replies` in order, recording what was sent. */
function stubFetch(replies) {
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    const reply = replies[requests.length - 1];
    if (typeof reply === 'function') return reply();
    return reply;
  };
}

/** The user turns in a Gemini request body. */
const turnsIn = (request) => request.contents.map((entry) => entry.parts[0].text);

describe('a model that answers badly', () => {
  test('is retried, and told what was wrong with the answer', async () => {
    stubFetch([geminiSays('not json at all'), geminiSays('{"verdict":"SUPPORTS"}')]);

    const result = await call();

    assert.equal(result.data.verdict, 'SUPPORTS');
    assert.equal(requests.length, 2);
    const second = turnsIn(requests[1]);
    assert.equal(second.length, 2, 'the retry carries the original turn plus the correction');
    assert.match(second[1], /rejected by validation/i);
  });
});

describe('a model that does not answer', () => {
  test('a timeout is not retried — the deterministic engine answers instead', async () => {
    stubFetch([
      () => {
        const error = new Error('The operation was aborted due to timeout');
        error.name = 'TimeoutError';
        throw error;
      },
      geminiSays('{"verdict":"SUPPORTS"}'),
    ]);

    await assert.rejects(call, /did not respond within/i);
    // The person has already waited the full deadline once. Waiting it out a
    // second time before falling back is worse than falling back now.
    assert.equal(requests.length, 1, 'a timeout must not cost a second deadline');
  });

  test('a spike in demand is retried with the request unaltered', async () => {
    stubFetch([
      httpFailure(503, 'This model is currently experiencing high demand.'),
      geminiSays('{"verdict":"SUPPORTS"}'),
    ]);

    const result = await call();

    assert.equal(result.data.verdict, 'SUPPORTS');
    assert.equal(requests.length, 2);
    // Nothing came back to be wrong, so nothing is fed back: the second request
    // is the first one again, not an argument with a model that never spoke.
    assert.deepEqual(turnsIn(requests[1]), [prompt.user]);
  });

  test('a rate limit this call will not wait out falls back at once', async () => {
    stubFetch([
      httpFailure(429, 'Quota exceeded. Please retry in 41.6s'),
      geminiSays('{"verdict":"SUPPORTS"}'),
    ]);

    await assert.rejects(call, /rate limited/i);
    assert.equal(requests.length, 1, 'a shut window does not reopen in the same millisecond');
  });

  test('a rejected key is not tried twice', async () => {
    stubFetch([httpFailure(401, 'API key not valid'), geminiSays('{"verdict":"SUPPORTS"}')]);

    await assert.rejects(call, /key was rejected/i);
    assert.equal(requests.length, 1);
  });
});

/**
 * A timeout is not a bad answer — it is no answer at all, and whether it is
 * worth asking again depends entirely on who is waiting.
 *
 * With someone watching a spinner, spending a second full deadline is worse
 * than answering now from the deterministic engine. In the background nobody is
 * waiting, and giving up early trades the real reading for a weak one. This
 * pair exists because raising the attempt count alone did nothing: the
 * give-up-on-timeout rule ran first and short-circuited it.
 */
describe('a model that does not answer at all', () => {
  /**
   * A fetch that answers nothing until its deadline, exactly as the real one
   * does — it has to honour the abort signal, or the request would hang forever
   * rather than time out.
   */
  const stubSilence = (thenReplies = []) => {
    let n = 0;
    globalThis.fetch = async (url, init) => {
      requests.push(JSON.parse(init.body));
      const reply = thenReplies[n++];
      if (reply) return reply;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted due to timeout');
          error.name = 'TimeoutError';
          reject(error);
        });
      });
    };
  };

  test('is abandoned after one attempt when someone is waiting', async () => {
    stubSilence();

    await assert.rejects(
      runStructured({ prompt, schema, jsonSchema: { type: 'object' }, maxAttempts: 3, timeoutMs: 60 }),
      /did not respond/i
    );
    assert.equal(requests.length, 1, 'a person does not wait out a second deadline');
  });

  test('is retried when nobody is waiting', async () => {
    stubSilence([undefined, geminiSays('{"verdict":"SUPPORTS"}')]);

    const result = await runStructured({
      prompt,
      schema,
      jsonSchema: { type: 'object' },
      patient: true,
      maxAttempts: 3,
      timeoutMs: 60,
    });

    assert.equal(result.data.verdict, 'SUPPORTS');
    assert.equal(requests.length, 2, 'patience asks again rather than falling back');
  });
});
