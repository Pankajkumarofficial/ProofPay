import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * One ephemeral stack per test file: a real mongod, the real Express app, the
 * real routes. Nothing is stubbed, because the things worth testing here —
 * concurrency, signature checks, state machines — only misbehave against a
 * real database.
 */

/**
 * The developer's own `.env` is switched off here, at **module scope**.
 *
 * This has to happen while this file is being evaluated, not inside
 * `startTestApp()`, and the difference is not cosmetic. `env.js` reads
 * `process.env` once when it is imported, and a test file that imports an app
 * module at the top — a model, a controller — pulls `env.js` in transitively
 * before any hook runs. By the time `startTestApp` assigned anything, the real
 * configuration was already frozen into `env`.
 *
 * That made the whole suite depend on whatever the developer happened to have
 * configured, and it hid the dependency by usually agreeing with it: the AI
 * tests stub Gemini's endpoint and passed for months because the `.env` on this
 * machine held a Gemini key. Point the same `.env` at a gateway and those tests
 * quietly began calling a paid third-party model over the network, taking real
 * verdicts from it and asserting them against numbers a stub was supposed to
 * provide.
 *
 * Since `helpers.js` is imported before the app modules in every test file,
 * doing it here means `env.js` sees a neutral environment no matter what is in
 * `.env`. A test that wants a provider sets it at the top of its own file,
 * before its first app import — which is the only moment that still counts.
 */
process.env.NODE_ENV = 'test';
process.env.ALLOW_MEMORY_DB = 'false';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32';
/** No test calls a model unless it says so, and none may reach a gateway. */
process.env.AI_API_KEY ??= '';
process.env.AI_BASE_URL = '';
/** The last mile is off unless a test asks for a rail. */
process.env.PAYOUTS_ENABLED = 'false';
/**
 * No test sends email. A machine with working SMTP credentials was quietly
 * mailing every throwaway signup address a test invents — burning a real
 * sending quota on addresses that bounce.
 */
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASSWORD = '';

let memoryServer = null;
let server = null;

export async function startTestApp(overrides = {}) {
  // Repeated for a suite that reassigned them, and harmless when nothing did.
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_MEMORY_DB = 'false';
  process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32';
  process.env.PAYOUTS_ENABLED = 'false';
  process.env.SMTP_HOST = '';
  process.env.SMTP_USER = '';
  process.env.SMTP_PASSWORD = '';
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;

  memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'proofpay-test' } });
  await mongoose.connect(memoryServer.getUri('proofpay-test'));

  const { createApp } = await import('../src/app.js');
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  return `http://127.0.0.1:${server.address().port}/api`;
}

export async function stopTestApp() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  server = null;
  memoryServer = null;
}

/** A signed-in client that carries its own cookie jar, like a browser would. */
export function client(base) {
  let cookie = '';
  const call = async (path, { method = 'POST', body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie.map((entry) => entry.split(';')[0]).join('; ');
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  return {
    call,
    get: (path) => call(path, { method: 'GET' }),
    async signUp(name = 'Test Payer') {
      const email = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.com`;
      await call('/auth/register', { body: { name, email, password: 'password123' } });
      return email;
    },
  };
}

/** A funded promise with one condition — the starting point for most tests. */
export async function fundedPromise(api, { amount = 1000, title = 'Test promise' } = {}) {
  const created = await api.call('/promises', {
    body: {
      title,
      amount,
      recipient: { name: 'Asha Rao', email: 'asha.rao@example.com' },
      conditions: [{ description: 'Deliver the signed report', type: 'deliverable' }],
    },
  });
  const promise = created.body.data.promise;
  await api.call(`/promises/${promise._id}/fund`, { body: {} });
  const conditions = await api.get(`/promises/${promise._id}/conditions`);
  return { promise, conditionId: conditions.body.data.conditions[0]._id };
}

/** Files proof that the local engine will accept, so the promise becomes releasable. */
/**
 * Files proof and waits for the Proof Engine to finish reading it.
 *
 * Submitting returns as soon as the proof is in the vault — the reading happens
 * behind the response — so a test that goes on to assert a verified condition
 * has to wait for that work, exactly as a real client waits for the event.
 */
export async function proveIt(api, promiseId, conditionId) {
  const filed = await api.call('/evidence', {
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

  const { settleAssessments } = await import('../src/controllers/evidenceController.js');
  await settleAssessments();
  return filed;
}
