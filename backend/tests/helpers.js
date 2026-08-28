import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * One ephemeral stack per test file: a real mongod, the real Express app, the
 * real routes. Nothing is stubbed, because the things worth testing here —
 * concurrency, signature checks, state machines — only misbehave against a
 * real database.
 */

let memoryServer = null;
let server = null;

export async function startTestApp(overrides = {}) {
  // env.js reads process.env once at import, so settings go in before it loads.
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_MEMORY_DB = 'false';
  process.env.AI_API_KEY = '';
  process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32';
  // env.js loads the developer's .env, so the last mile is switched off here
  // unless a test asks for a rail. Otherwise these runs would settle differently
  // on different machines.
  process.env.PAYOUTS_ENABLED = 'false';
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
      recipient: { name: 'Asha Rao' },
      conditions: [{ description: 'Deliver the signed report', type: 'deliverable' }],
    },
  });
  const promise = created.body.data.promise;
  await api.call(`/promises/${promise._id}/fund`, { body: {} });
  const conditions = await api.get(`/promises/${promise._id}/conditions`);
  return { promise, conditionId: conditions.body.data.conditions[0]._id };
}

/** Files proof that the local engine will accept, so the promise becomes releasable. */
export async function proveIt(api, promiseId, conditionId) {
  return api.call('/evidence', {
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
}
