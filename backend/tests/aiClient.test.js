import test, { before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';

/** What the Proof Engine does when the model does not answer. */

// env.js reads process.env once at import, so the key goes in before it loads.
process.env.AI_API_KEY = 'AIzaTestKeyForTheProofEngine';
process.env.AI_PROVIDER = 'gemini';
// A developer with AI_BASE_URL set would otherwise run this whole suite against a gateway.
process.env.AI_BASE_URL = '';
// The real overload wait is seconds long on purpose.
process.env.AI_OVERLOAD_RETRY_MS = '40';
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
    // The person has already waited the full deadline once.
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
    // Nothing came back to be wrong, so nothing is fed back.
    assert.deepEqual(turnsIn(requests[1]), [prompt.user]);
  });

  /** An overload used to be indistinguishable from a malformed response. */
  test('a spike in demand is waited out longer each time it is refused', async () => {
    stubFetch([
      httpFailure(503, 'This model is currently experiencing high demand.'),
      httpFailure(503, 'This model is currently experiencing high demand.'),
      geminiSays('{"verdict":"SUPPORTS"}'),
    ]);

    // The gap before each call.
    const waits = [];
    const inner = globalThis.fetch;
    let previous = Date.now();
    globalThis.fetch = async (url, init) => {
      const now = Date.now();
      waits.push(now - previous);
      previous = now;
      return inner(url, init);
    };

    const result = await runStructured({
      prompt,
      schema,
      jsonSchema: { type: 'object' },
      patient: true,
      maxAttempts: 3,
      maxRateLimitWaits: 3,
    });

    assert.equal(result.data.verdict, 'SUPPORTS');
    assert.equal(requests.length, 3, 'an overload is asked again rather than abandoned');
    // waits[0] is the first call, which waits for nothing.
    assert.ok(waits[1] >= 30, `first retry waited ${waits[1]}ms, expected a real pause`);
    assert.ok(
      waits[2] > waits[1],
      `second retry waited ${waits[2]}ms, no longer than the first (${waits[1]}ms)`
    );
  });

  test('an overload is not reported as a rate limit', async () => {
    stubFetch([
      httpFailure(503, 'This model is currently experiencing high demand.'),
      httpFailure(503, 'This model is currently experiencing high demand.'),
    ]);

    // Naming the wrong cause sends someone to check a key that is fine.
    await assert.rejects(
      () => runStructured({ prompt, schema, jsonSchema: { type: 'object' }, maxAttempts: 2 }),
      (error) => {
        assert.match(error.message, /overloaded/i);
        assert.doesNotMatch(error.message, /rate limited|out of quota|no credit/i);
        return true;
      }
    );
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

  /** This suite pins AI_PROVIDER to gemini, so the guess is not in play here and the message stays plain. */
  test('a rejected key names the provider, and does not speculate when it was told', async () => {
    stubFetch([httpFailure(401, 'API key not valid')]);

    await assert.rejects(call, (error) => {
      assert.match(error.message, /gemini key was rejected/i);
      assert.doesNotMatch(error.message, /inferred/i);
      return true;
    });
  });
});

/** A timeout is not a bad answer. */
describe('a model that does not answer at all', () => {
  /** A fetch that answers nothing until its deadline, exactly as the real one does. */
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

/** Which vendor a key belongs to is a guess, and the guess is wrong in a way no status code reveals. */
describe('a provider inferred from the key prefix', () => {
  /** Runs one rejected call under the given env, and returns what was printed. */
  const messageUnder = (env) => {
    const client = new URL('../src/services/aiClient.js', import.meta.url).href;
    const script = `
      import { z } from 'zod';
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Incorrect API key provided' } }),
      });
      const { runStructured } = await import(${JSON.stringify(client)});
      try {
        await runStructured({
          prompt: { system: 's', user: 'u' },
          schema: z.object({ a: z.string() }),
          jsonSchema: { type: 'object' },
          maxAttempts: 1,
        });
      } catch (error) {
        console.log(error.message);
      }
    `;
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      // dotenv does not override what is already set, so these win over .env.
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  };

  test('admits the vendor was a guess when an "sk-" key is rejected', () => {
    const message = messageUnder({
      AI_API_KEY: 'sk-notarealkeyatall',
      AI_PROVIDER: 'auto',
      AI_BASE_URL: '',
    });

    assert.match(message, /openai key was rejected \(401\)/i);
    // The sentence that turns "your key is bad" into "you may have pasted the right key for the wrong.
    assert.match(message, /inferred from the key starting "sk-"/i);
    assert.match(message, /set AI_PROVIDER/i);
  });

  test('does not second-guess a provider it was told explicitly', () => {
    const message = messageUnder({
      AI_API_KEY: 'sk-notarealkeyatall',
      AI_PROVIDER: 'openai',
      AI_BASE_URL: '',
    });

    assert.match(message, /openai key was rejected \(401\)/i);
    assert.doesNotMatch(message, /inferred/i);
  });
});

/** A gateway: a host that speaks OpenAI's wire format while serving somebody else's models. */
describe('an OpenAI-compatible gateway', () => {
  /** Runs one stubbed call under the given env, and returns what was observed. */
  const observe = (env, script) => {
    const client = new URL('../src/services/aiClient.js', import.meta.url).href;
    const body = `
      import { z } from 'zod';
      let seen = {};
      globalThis.fetch = async (url, init) => {
        seen = { url, body: JSON.parse(init.body) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"verdict":"SUPPORTS"}' } }],
            usage: {},
          }),
        };
      };
      const client = await import(${JSON.stringify(client)});
      const { runStructured, engineDescriptor } = client;
      ${script}
    `;
    return JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', body], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    );
  };

  const gatewayEnv = {
    AI_BASE_URL: 'https://tabitoken.com/v1',
    AI_MODEL: 'claude-opus-5',
    AI_API_KEY: 'sk-akeythegatewayissued',
    AI_PROVIDER: 'auto',
  };

  test('is chosen by its URL, not by the key prefix', () => {
    const out = observe(
      gatewayEnv,
      `const r = await runStructured({
         prompt: { system: 's', user: 'u' },
         schema: z.object({ verdict: z.string() }),
         jsonSchema: { type: 'object' },
       });
       console.log(JSON.stringify({ url: seen.url, model: seen.body.model }));`
    );

    // An `sk-` key would otherwise have gone to api.openai.com, which never issued it.
    assert.equal(out.url, 'https://tabitoken.com/v1/chat/completions');
    assert.equal(out.model, 'claude-opus-5');
  });

  test('is labelled by its host, never by the vendor whose protocol it borrows', () => {
    const out = observe(
      gatewayEnv,
      `const r = await runStructured({
         prompt: { system: 's', user: 'u' },
         schema: z.object({ verdict: z.string() }),
         jsonSchema: { type: 'object' },
       });
       console.log(JSON.stringify({ engine: r.engine, model: r.model, badge: engineDescriptor() }));`
    );

    assert.equal(out.engine, 'tabitoken.com');
    assert.notEqual(out.engine, 'openai');
    assert.equal(out.badge.engine, 'tabitoken.com');
    assert.equal(out.badge.model, 'claude-opus-5');
  });

  test('refuses to run without a named model, rather than sending an empty one', () => {
    const out = observe(
      { ...gatewayEnv, AI_MODEL: '' },
      `try {
         await runStructured({
           prompt: { system: 's', user: 'u' },
           schema: z.object({ verdict: z.string() }),
           jsonSchema: { type: 'object' },
         });
         console.log(JSON.stringify({ error: null }));
       } catch (error) {
         console.log(JSON.stringify({ error: error.message }));
       }`
    );

    assert.match(out.error, /AI_MODEL must name a model/i);
    assert.match(out.error, /tabitoken\.com/);
  });
});
