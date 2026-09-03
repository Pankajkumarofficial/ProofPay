#!/usr/bin/env node
/**
 * Scores both Proof Engines against the same labelled set.
 *
 *   npm run eval            both engines
 *   npm run eval -- --local only the deterministic engine (no key, no cost)
 *
 * Writes a markdown report to eval/report.md.
 *
 * The headline number is not accuracy. ProofPay's claim is that money moves
 * only when a promise is proven, so the error that matters is a **false
 * accept** — waving through a claim with no artefact behind it. An engine that
 * scores well overall while making those is worse than one that does not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as localEngine from '../src/services/localEngine.js';
import { runStructured, activeProvider, engineDescriptor } from '../src/services/aiClient.js';
import { promiseParserPrompt, ambiguityDetectorPrompt, evidenceVerifierPrompt } from '../src/prompts/index.js';
import {
  parsedPromiseSchema,
  parsedPromiseJsonSchema,
  ambiguityReportSchema,
  ambiguityReportJsonSchema,
  evidenceAssessmentSchema,
  evidenceAssessmentJsonSchema,
} from '../src/validators/aiSchemas.js';
import { ambiguityCases, parseCases, evidenceCases } from './cases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const localOnly = process.argv.includes('--local');

/**
 * `--only evidence` scores the model on one set instead of all three.
 *
 * The sets are not equally worth paying for. The report ranks on **false
 * accepts**, and only the evidence set produces them — ambiguity and parsing
 * measure how well a sentence was read, not whether money would have moved
 * wrongly. So when a call costs something, this is the set to buy.
 *
 * It restricts the model only. The deterministic engine is instant and free, so
 * it is still scored on everything and the report says which sets the model was
 * not asked about, rather than quietly showing one engine's numbers as though
 * both had been measured.
 */
const onlyArg = process.argv.find((arg) => arg.startsWith('--only'));
const only = onlyArg ? (onlyArg.split('=')[1] ?? process.argv[process.argv.indexOf(onlyArg) + 1]) : null;
const SETS = ['ambiguity', 'parsing', 'evidence'];
if (only && !SETS.includes(only)) {
  console.error(`--only takes one of: ${SETS.join(', ')}`);
  process.exit(1);
}
/** Whether this engine should be scored on a given set. */
const scores = (engine, set) => engine === 'local' || !only || only === set;

/** `--sample N` scores the first N of each set, for a cheap smoke run. */
const sampleArg = process.argv.find((arg) => arg.startsWith('--sample'));
const sample = sampleArg ? Number(sampleArg.split('=')[1] ?? process.argv[process.argv.indexOf(sampleArg) + 1]) : null;
const take = (list) => (sample ? list.slice(0, sample) : list);

/** A verdict counts as accepting only if it would let money move. */
const decisionOf = (assessment) =>
  assessment.verdict === 'SUPPORTS' && assessment.confidence >= 70 ? 'ACCEPT' : 'REFUSE';

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');

/**
 * Free tiers cap requests per minute, so the harness paces itself rather than
 * sprinting into a 429 and calling it a result.
 */
const PACE_MS = Number(process.env.EVAL_PACE_MS) || 3200;
let lastCall = 0;

async function model(kind, { prompt, schema, jsonSchema, effort = 'low' }) {
  const wait = PACE_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  // Nobody is watching a batch run, so here it is worth waiting out a free-tier
  // window rather than scoring the fallback by mistake.
  // Nobody is waiting on a batch score, so the harness takes the patient path:
  // the longer deadline, and a timeout retried rather than recorded as silence.
  // Without it a slow minute on a free tier is indistinguishable from a model
  // that could not answer, and the run measures the quota rather than the model.
  const result = await runStructured({
    prompt,
    schema,
    jsonSchema,
    effort,
    name: kind,
    patient: true,
    maxAttempts: 3,
    maxRateLimitWaits: 3,
  });
  return result.data;
}

/**
 * A harness that dies on one bad call cannot measure reliability. A case the
 * engine could not answer is a result — recorded and counted, not a crash.
 */
let skipped = [];
async function attempt(label, work, fallback) {
  try {
    return await work();
  } catch (error) {
    skipped.push(`${label}: ${error.message.slice(0, 90)}`);
    process.stdout.write('  !');
    return fallback;
  }
}

/* ── ambiguity ───────────────────────────────────────────────────────────── */

async function scoreAmbiguity(engine) {
  let caught = 0;
  let missed = 0;
  let falseAlarms = 0;
  const notes = [];

  for (const testCase of take(ambiguityCases)) {
    const report =
      engine === 'local'
        ? localEngine.scanAmbiguity({ text: testCase.text, conditions: [] })
        : await attempt(
            `ambiguity "${testCase.text.slice(0, 30)}"`,
            () =>
              model('AMBIGUITY_SCAN', {
                prompt: ambiguityDetectorPrompt({ text: testCase.text, conditions: [] }),
                schema: ambiguityReportSchema,
                jsonSchema: ambiguityReportJsonSchema,
              }),
            { ambiguities: [] }
          );

    const flagged = (report.ambiguities ?? []).map((entry) => entry.phrase.toLowerCase());
    const hit = (word) => flagged.some((phrase) => phrase.includes(word.toLowerCase()));

    if (testCase.shouldFlag.length === 0) {
      if (flagged.length) {
        falseAlarms += 1;
        notes.push(`false alarm on a clear promise: flagged ${flagged.map((f) => `"${f}"`).join(', ')}`);
      }
      continue;
    }
    for (const word of testCase.shouldFlag) {
      if (hit(word)) caught += 1;
      else {
        missed += 1;
        notes.push(`missed "${word}" in: ${testCase.text.slice(0, 60)}…`);
      }
    }
  }

  const vague = take(ambiguityCases).filter((c) => c.shouldFlag.length).length;
  const clear = take(ambiguityCases).length - vague;
  return { caught, missed, falseAlarms, vague, clear, notes };
}

/* ── parsing ─────────────────────────────────────────────────────────────── */

async function scoreParsing(engine) {
  const rows = [];
  let amount = 0;
  let recipient = 0;
  let conditions = 0;

  for (const testCase of take(parseCases)) {
    const draft =
      engine === 'local'
        ? localEngine.parsePromise({ text: testCase.text })
        : await attempt(
            `parse "${testCase.text.slice(0, 30)}"`,
            () =>
              model('PROMISE_PARSE', {
                prompt: promiseParserPrompt({ text: testCase.text }),
                schema: parsedPromiseSchema,
                jsonSchema: parsedPromiseJsonSchema,
              }),
            { amount: null, currency: null, recipient: null, conditions: [] }
          );

    const amountOk = draft.amount === testCase.expect.amount;
    const recipientOk = testCase.expect.recipient.test(draft.recipient ?? '');
    const conditionsOk = (draft.conditions ?? []).length === testCase.expect.conditions;

    if (amountOk) amount += 1;
    if (recipientOk) recipient += 1;
    if (conditionsOk) conditions += 1;

    rows.push({
      text: testCase.text.slice(0, 52),
      amountOk,
      recipientOk,
      conditionsOk,
      got: `${draft.amount ?? '—'} ${draft.currency ?? ''} · ${draft.recipient ?? '—'} · ${(draft.conditions ?? []).length} cond`,
    });
  }

  return { rows, amount, recipient, conditions, total: take(parseCases).length };
}

/* ── evidence: the one that decides whether money moves ──────────────────── */

async function scoreEvidence(engine) {
  const rows = [];
  let truePositive = 0; // correctly accepted real proof
  let trueNegative = 0; // correctly refused a bare claim
  let falsePositive = 0; // accepted a bare claim — money would have moved
  let falseNegative = 0; // refused genuine proof — honest work stranded

  for (const testCase of take(evidenceCases)) {
    const assessment =
      engine === 'local'
        ? localEngine.assessEvidence({ condition: testCase.condition, evidence: testCase.evidence })
        : await attempt(
            `evidence "${testCase.label}"`,
            () =>
              model('EVIDENCE_VERIFICATION', {
                prompt: evidenceVerifierPrompt({
                  promise: { title: 'Evaluation', amount: 10000, currency: 'INR' },
                  condition: testCase.condition,
                  evidence: testCase.evidence,
                  siblingEvidence: [],
                }),
                schema: evidenceAssessmentSchema,
                jsonSchema: evidenceAssessmentJsonSchema,
                effort: 'medium',
              }),
            // No answer must never read as approval.
            { verdict: 'INSUFFICIENT', confidence: 0, explanation: 'The engine could not be reached.' }
          );

    const decision = decisionOf(assessment);
    const correct = decision === testCase.expect;

    if (testCase.expect === 'ACCEPT') correct ? (truePositive += 1) : (falseNegative += 1);
    else correct ? (trueNegative += 1) : (falsePositive += 1);

    rows.push({
      label: testCase.label,
      expect: testCase.expect,
      decision,
      correct,
      confidence: assessment.confidence,
      verdict: assessment.verdict,
      why: (assessment.explanation ?? '').slice(0, 120),
    });
  }

  const accepted = truePositive + falsePositive;
  const shouldAccept = truePositive + falseNegative;
  return {
    rows,
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,
    precision: accepted ? truePositive / accepted : 0,
    recall: shouldAccept ? truePositive / shouldAccept : 0,
    accuracy: (truePositive + trueNegative) / take(evidenceCases).length,
  };
}

/* ── report ──────────────────────────────────────────────────────────────── */

async function evaluate(engine, label) {
  process.stdout.write(`\n▶ ${label}\n`);
  const startedAt = Date.now();
  skipped = [];
  const ambiguity = scores(engine, 'ambiguity') ? await scoreAmbiguity(engine) : null;
  const parsing = scores(engine, 'parsing') ? await scoreParsing(engine) : null;
  const evidence = scores(engine, 'evidence') ? await scoreEvidence(engine) : null;
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (ambiguity) console.log(`  ambiguity  caught ${ambiguity.caught}/${ambiguity.caught + ambiguity.missed} · false alarms ${ambiguity.falseAlarms}/${ambiguity.clear}`);
  if (parsing) console.log(`  parsing    amount ${parsing.amount}/${parsing.total} · recipient ${parsing.recipient}/${parsing.total} · conditions ${parsing.conditions}/${parsing.total}`);
  if (evidence) console.log(`  evidence   accuracy ${pct(evidence.truePositive + evidence.trueNegative, take(evidenceCases).length)} · FALSE ACCEPTS ${evidence.falsePositive} · false refusals ${evidence.falseNegative}`);
  for (const set of SETS) {
    if (!scores(engine, set)) console.log(`  ${set.padEnd(10)} not scored (--only ${only})`);
  }
  console.log(`  ${seconds}s`);

  if (skipped.length) console.log(`  ⚠ ${skipped.length} case(s) unanswered: ${skipped[0]}`);
  return { engine, label, ambiguity, parsing, evidence, seconds, skipped: [...skipped] };
}

function report(results) {
  const line = [];
  const w = (s = '') => line.push(s);

  w('# Proof Engine evaluation');
  w('');
  w(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ` +
    `${ambiguityCases.length} ambiguity cases · ${parseCases.length} parse cases · ${evidenceCases.length} evidence cases`);
  w('');
  w('Both engines are scored against the same hand-labelled set. The labels were');
  w('written before either engine ran, and several cases are ones the');
  w('deterministic engine is expected to win.');
  w('');
  if (only) {
    w(`**The model was scored on the ${only} set only.** This gateway bills per call`);
    w('rather than per token, so the sets were not equally worth buying: false');
    w('accepts are the error that moves money wrongly, and only the evidence set');
    w('produces them. Where a row below reads *not scored*, the model was not');
    w('asked — which is different from asking and getting it wrong, and is shown');
    w('separately for that reason.');
    w('');
  }
  w('**The number that matters is false accepts.** ProofPay releases money only');
  w('when a promise is proven, so waving through a claim with no artefact behind');
  w('it is the expensive error — an engine that scores well overall while making');
  w('those is worse than one that does not.');
  w('');

  w('## Evidence assessment');
  w('');
  w('| Engine | Accuracy | Precision | Recall | **False accepts** | False refusals |');
  w('|---|---|---|---|---|---|');
  for (const r of results) {
    const e = r.evidence;
    if (!e) {
      w(`| ${r.label} | — | — | — | — | — |`);
      continue;
    }
    w(`| ${r.label} | ${(e.accuracy * 100).toFixed(0)}% | ${(e.precision * 100).toFixed(0)}% | ${(e.recall * 100).toFixed(0)}% | **${e.falsePositive}** | ${e.falseNegative} |`);
  }
  w('');
  w('*Precision here is: of the proofs an engine accepted, how many were real.*');
  w('');

  for (const r of results.filter((x) => x.evidence)) {
    w(`### ${r.label} — case by case`);
    w('');
    w('| Case | Expected | Decided | Verdict | Conf | |');
    w('|---|---|---|---|---|---|');
    for (const row of r.evidence.rows) {
      w(`| ${row.label} | ${row.expect} | ${row.decision} | ${row.verdict} | ${row.confidence}% | ${row.correct ? '✓' : '✗'} |`);
    }
    w('');
  }

  w('## Ambiguity detection');
  w('');
  w('| Engine | Vague phrases caught | False alarms on clear promises |');
  w('|---|---|---|');
  for (const r of results) {
    const a = r.ambiguity;
    w(a ? `| ${r.label} | ${a.caught}/${a.caught + a.missed} | ${a.falseAlarms}/${a.clear} |` : `| ${r.label} | not scored | not scored |`);
  }
  w('');

  w('## Parsing a sentence into a payable structure');
  w('');
  w('| Engine | Amount | Recipient | Condition count |');
  w('|---|---|---|---|');
  for (const r of results) {
    const p = r.parsing;
    w(p ? `| ${r.label} | ${p.amount}/${p.total} | ${p.recipient}/${p.total} | ${p.conditions}/${p.total} |` : `| ${r.label} | not scored | not scored | not scored |`);
  }
  w('');

  const anySkipped = results.some((r) => r.skipped?.length);
  if (anySkipped) {
    w('## Cases the engine could not answer');
    w('');
    w('Recorded rather than hidden. An unanswered evidence case is counted as a');
    w('refusal, because no answer must never read as approval.');
    w('');
    for (const r of results.filter((x) => x.skipped?.length)) {
      w(`**${r.label}** — ${r.skipped.length}`);
      w('');
      for (const note of r.skipped.slice(0, 6)) w(`- ${note}`);
      w('');
    }
  }

  w('## Runtime');
  w('');
  w('| Engine | Wall clock |');
  w('|---|---|');
  for (const r of results) w(`| ${r.label} | ${r.seconds}s |`);
  w('');
  w('The deterministic engine is effectively instant and free. That is why it is');
  w('the fallback rather than a stub: when a model call fails, ProofPay keeps');
  w('working, and the interface says which engine answered.');
  w('');

  return line.join('\n');
}

const provider = activeProvider();
const results = [await evaluate('local', 'Local engine (rules)')];

if (!localOnly && provider) {
  // Scoring a model means spending its quota. On a free tier that starves the
  // running app, which then answers from the local engine — so say so plainly
  // rather than letting someone wonder why their AI stopped working.
  const calls =
    (scores('model', 'ambiguity') ? take(ambiguityCases).length : 0) +
    (scores('model', 'parsing') ? take(parseCases).length : 0) +
    (scores('model', 'evidence') ? take(evidenceCases).length : 0);
  const { engine: engineName } = engineDescriptor();
  console.log(
    `\n⚠ About to make ${calls} calls to ${engineName}.\n` +
      `  Free tiers cap around 20 per minute, so while this runs the app will\n` +
      `  fall back to the local engine.\n` +
      `  Some gateways bill a flat rate per call rather than per token, which\n` +
      `  makes a re-run cost the same as the first run — check before repeating\n` +
      `  one to fix a label.\n` +
      `  --local skips the model · --only evidence buys just the set the report\n` +
      `  ranks on · --sample 3 is a cheap smoke run.`
  );
  // The engine column is where a reader checks who actually answered, so it
  // carries the descriptor — a gateway names its host and its model, never the
  // vendor whose wire format it borrowed.
  const { engine, model } = engineDescriptor();
  results.push(await evaluate('model', model ? `${engine} · ${model}` : `${engine} (model)`));
} else if (!localOnly) {
  console.log('\n⚠ No AI_API_KEY set — scored the local engine only.');
}

const markdown = report(results);
fs.writeFileSync(path.join(here, 'report.md'), markdown);
console.log(`\n✓ eval/report.md written`);

if (results.length === 2) {
  const [local, ai] = results;
  console.log(
    `\nFalse accepts — the error that moves money wrongly:\n` +
      `  ${local.label}: ${local.evidence.falsePositive} of ${local.evidence.falsePositive + local.evidence.trueNegative}\n` +
      `  ${ai.label}: ${ai.evidence.falsePositive} of ${ai.evidence.falsePositive + ai.evidence.trueNegative}`
  );
}
