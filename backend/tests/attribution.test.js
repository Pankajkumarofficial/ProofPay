import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, stopTestApp } from './helpers.js';

/**
 * Who produced a reading, and whether the record can say so.
 *
 * ProofPay's central claim is that a reading is never attributed to a model that
 * did not make it. That claim lives or dies on one field — `AIAnalysis.engine` —
 * and it is the field most easily broken by adding a provider, because the
 * constraint that keeps it honest is the same constraint that rejects anything
 * new.
 *
 * That is not hypothetical: a fixed enum of the three vendors silently refused
 * every reading produced through a gateway. The write failed, the assessment was
 * lost, and the log blamed the model. These hold the line in both directions —
 * a gateway host is recordable, and free text still is not.
 */

let AIAnalysis;

before(async () => {
  await startTestApp();
  ({ AIAnalysis } = await import('../src/models/index.js'));
});
after(stopTestApp);

/** The smallest valid analysis record, with the engine under test. */
const record = (engine) => ({
  kind: 'EVIDENCE_VERIFICATION',
  input: 'a condition and an artefact',
  output: { verdict: 'SUPPORTS', confidence: 91 },
  engine,
  valid: true,
});

describe('the engine a reading is recorded against', () => {
  test('accepts the vendors and the local engine', async () => {
    for (const engine of ['openai', 'anthropic', 'gemini', 'local-engine']) {
      const saved = await AIAnalysis.create(record(engine));
      assert.equal(saved.engine, engine);
    }
  });

  test('accepts a gateway host, because a gateway is not one of the vendors', async () => {
    for (const host of ['tabitoken.com', 'api.openrouter.ai', 'localhost:4000']) {
      const saved = await AIAnalysis.create(record(host));
      assert.equal(saved.engine, host);
      // The point of the whole exercise: a reseller of somebody else's models is
      // never written down under the name of the vendor whose protocol it borrows.
      assert.notEqual(saved.engine, 'openai');
    }
  });

  test('refuses free text, which is what the constraint was guarding', async () => {
    // `gpt-4.1-mini` is the one worth naming: it satisfies a naive host pattern
    // (`gpt-4` then `1-mini`), and a model name in the engine column is the very
    // misattribution this field exists to prevent.
    for (const engine of ['', 'the ai', 'openai (via a proxy)', 'gpt-4.1-mini', 'claude-opus-5']) {
      await assert.rejects(
        () => AIAnalysis.create(record(engine)),
        /is neither a known engine nor a gateway host|`engine` is required/i,
        `"${engine}" should not be recordable as an engine`
      );
    }
  });
});
