#!/usr/bin/env node
/**
 * Says what the Proof Engine is actually configured to talk to, and proves it.
 *
 *   npm run check:ai --prefix backend
 *   npm run check:ai --prefix backend -- --models    # also list the catalogue
 *
 * The engine has four ways to be wrong about its own identity, and all of them
 * look like a working config until a call is made:
 *
 *   - a key whose prefix routes it to a vendor that never issued it
 *   - a gateway serving somebody else's models under OpenAI's wire format
 *   - a model name the active provider will not accept
 *   - a key that is simply rejected, which reads the same as all of the above
 *
 * So this resolves the configuration, makes one real structured call, and
 * prints the label that would end up on an assessment — because that label is
 * the app's central claim, and a claim nobody checks is a claim nobody should
 * believe.
 */
import { env } from '../src/config/env.js';
import { z } from 'zod';
import { activeProvider, engineDescriptor, runStructured } from '../src/services/aiClient.js';
import { gatewayHost, modelFor } from '../src/services/aiProviders.js';

const listModels = process.argv.includes('--models');

const green = (s) => `[32m${s}[0m`;
const red = (s) => `[31m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;

const provider = activeProvider();

console.log('\nProof Engine — configuration check\n');

if (!provider) {
  console.log(`  engine     : ${green('local engine (rules)')}`);
  console.log(`  reason     : AI_API_KEY is empty`);
  console.log(
    `\n${dim('This is a supported mode, not a failure: the deterministic engine answers')}\n` +
      `${dim('every capability, and the UI labels it as the one that did.')}\n`
  );
  process.exit(0);
}

const descriptor = engineDescriptor();

console.log(`  provider   : ${provider}${provider === 'gateway' ? dim('  (OpenAI wire format, someone else’s models)') : ''}`);
console.log(`  endpoint   : ${env.ai.baseUrl || dim('(the vendor’s own)')}`);
console.log(`  model      : ${modelFor(provider) || red('(none — AI_MODEL is required for a gateway)')}`);
console.log(`  labelled as: ${descriptor.engine}${descriptor.model ? ` · ${descriptor.model}` : ''}`);

if (provider === 'gateway') {
  console.log(
    dim(`\n  A gateway is labelled by its host, never by the vendor whose protocol it`) +
      dim(`\n  borrows — attributing a reading to a company that did not make it is the`) +
      dim(`\n  one thing every label in this app exists to prevent.`)
  );
}

/* ── the catalogue, where the provider exposes one ────────────────────────── */

if (listModels) {
  const base = env.ai.baseUrl || (provider === 'openai' ? 'https://api.openai.com/v1' : null);
  if (!base) {
    console.log(`\n  ${dim('--models is only meaningful for OpenAI-compatible endpoints.')}`);
  } else {
    process.stdout.write(`\n  catalogue  : `);
    try {
      const response = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${env.ai.apiKey}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.log(red(`HTTP ${response.status}`), payload?.error?.message ?? '');
      } else {
        const ids = (payload.data ?? []).map((m) => m.id);
        console.log(ids.length ? `${ids.length} model(s)` : dim('(empty)'));
        for (const id of ids) {
          const active = id === modelFor(provider);
          console.log(`               ${active ? green('▸ ' + id) : '  ' + id}`);
        }
        if (ids.length && !ids.includes(modelFor(provider))) {
          console.log(
            `\n  ${red('AI_MODEL is not in this catalogue.')} Set it to one of the ids above,` +
              `\n  ${dim('exactly as written — a gateway matches on the literal string.')}`
          );
        }
      }
    } catch (error) {
      console.log(red('unreachable'), error.message);
    }
  }
}

/* ── one real call, because configuration is not capability ──────────────── */

process.stdout.write('\n  live call  : ');
try {
  const result = await runStructured({
    prompt: {
      system:
        'You are the Proof Engine. Reply with JSON only, matching the schema exactly: ' +
        '{"verdict":"SUPPORTS"|"INSUFFICIENT","confidence":<integer 0-100>}.',
      user:
        'Condition: "the invoice is paid". Evidence: a bank statement line showing a ' +
        'transfer of the invoiced amount to the invoiced account on the due date. ' +
        'Does the evidence support the condition?',
    },
    schema: z.object({ verdict: z.string(), confidence: z.number() }),
    jsonSchema: {
      type: 'object',
      properties: { verdict: { type: 'string' }, confidence: { type: 'number' } },
      required: ['verdict', 'confidence'],
      additionalProperties: false,
    },
    name: 'CONFIG_CHECK',
    patient: true,
    maxAttempts: 3,
    maxRateLimitWaits: 2,
  });

  console.log(green('answered'));
  console.log(`  answered by: ${result.engine} · ${result.model}`);
  console.log(`  attempts   : ${result.attempts} · ${result.latencyMs}ms`);
  console.log(`  verdict    : ${result.data.verdict} at ${result.data.confidence}%`);
  console.log(
    `\n${green('The Proof Engine is live.')} Assessments will be recorded against ` +
      `"${result.engine}".\n`
  );
} catch (error) {
  console.log(red('failed'));
  console.log(`  reason     : ${error.message}`);
  console.log(
    `\n${dim('The app still runs: every capability falls back to the deterministic engine,')}\n` +
      `${dim('and the interface says which one answered. Fix the above to score a model.')}\n`
  );
  process.exit(1);
}
