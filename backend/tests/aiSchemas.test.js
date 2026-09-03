import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsedPromiseSchema,
  parsedPromiseJsonSchema,
  ambiguityReportSchema,
  ambiguityReportJsonSchema,
  evidenceAssessmentSchema,
  evidenceAssessmentJsonSchema,
  disputeReportSchema,
  disputeReportJsonSchema,
  explanationSchema,
  explanationJsonSchema,
} from '../src/validators/aiSchemas.js';

/**
 * The two halves of every contract must state the same limits.
 *
 * Each contract exists twice: a JSON Schema sent to the model, and a Zod schema
 * that validates what comes back. When only the Zod half carries a bound, the
 * model is judged by a rule it was never shown — it writes a 400-character
 * contradiction against an unstated 300-character cap, validation rejects the
 * whole response, and a retry is spent teaching it a limit that could have been
 * in the original request.
 *
 * That stayed hidden for as long as the engines were terse. A verbose model
 * tripped it on nearly every call, which is the useful thing about this class
 * of bug: it is invisible until the day it is constant.
 *
 * So this walks the Zod schemas rather than restating their numbers. A new cap
 * added on one side fails here until it is added to the other, which is the only
 * way two hand-written descriptions of one contract stay in agreement.
 */

/** Unwraps the layers Zod puts around a type: .default(), .nullable(), .catch(). */
function unwrap(schema) {
  let node = schema;
  for (let depth = 0; depth < 12; depth += 1) {
    const inner = node?._def?.innerType ?? node?._def?.schema;
    if (!inner) return node;
    node = inner;
  }
  return node;
}

const checkValue = (node, kind) =>
  (node?._def?.checks ?? []).find((check) => check.kind === kind)?.value;

/**
 * Every constraint the Zod half enforces, as `path -> { keyword: value }` in
 * JSON Schema's vocabulary, so the two can be compared directly.
 */
function zodLimits(schema, path = [], out = new Map()) {
  const node = unwrap(schema);
  const type = node?._def?.typeName;

  if (type === 'ZodObject') {
    const shape = node._def.shape();
    for (const [key, child] of Object.entries(shape)) zodLimits(child, [...path, key], out);
    return out;
  }

  if (type === 'ZodArray') {
    const limits = {};
    const maxItems = node._def.maxLength?.value;
    const minItems = node._def.minLength?.value;
    if (maxItems !== undefined) limits.maxItems = maxItems;
    if (minItems !== undefined) limits.minItems = minItems;
    if (Object.keys(limits).length) out.set(path.join('.'), limits);
    zodLimits(node._def.type, [...path, '[]'], out);
    return out;
  }

  if (type === 'ZodString') {
    const limits = {};
    // .length(3) registers as both, which is exactly how JSON Schema says it.
    const max = checkValue(node, 'max') ?? checkValue(node, 'length');
    const min = checkValue(node, 'min') ?? checkValue(node, 'length');
    if (max !== undefined) limits.maxLength = max;
    if (min !== undefined) limits.minLength = min;
    if (Object.keys(limits).length) out.set(path.join('.'), limits);
    return out;
  }

  if (type === 'ZodNumber') {
    const limits = {};
    const max = checkValue(node, 'max');
    const min = checkValue(node, 'min');
    if (max !== undefined) limits.maximum = max;
    // `.positive()` is a min of 0 that excludes it, which JSON Schema spells
    // differently — so it is checked as an exclusive bound, not a minimum.
    if (min !== undefined) limits[node._def.checks.find((c) => c.kind === 'min')?.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = min;
    if (Object.keys(limits).length) out.set(path.join('.'), limits);
    return out;
  }

  return out;
}

/** Follows the same path through a JSON Schema, stepping into `items` for `[]`. */
function jsonNodeAt(jsonSchema, path) {
  let node = jsonSchema;
  for (const segment of path) {
    if (!node) return null;
    node = segment === '[]' ? node.items : node.properties?.[segment];
  }
  return node ?? null;
}

const contracts = [
  ['a parsed promise', parsedPromiseSchema, parsedPromiseJsonSchema],
  ['an ambiguity report', ambiguityReportSchema, ambiguityReportJsonSchema],
  ['an evidence assessment', evidenceAssessmentSchema, evidenceAssessmentJsonSchema],
  ['a dispute report', disputeReportSchema, disputeReportJsonSchema],
  ['an explanation', explanationSchema, explanationJsonSchema],
];

describe('the model is told every rule it will be judged by', () => {
  for (const [name, zodSchema, jsonSchema] of contracts) {
    test(`${name} states its limits in both halves`, () => {
      const limits = zodLimits(zodSchema);
      assert.ok(limits.size > 0, 'this contract should enforce something worth stating');

      const missing = [];
      for (const [dotted, expected] of limits) {
        const path = dotted.split('.');
        const node = jsonNodeAt(jsonSchema, path);
        if (!node) {
          missing.push(`${dotted} — no matching node in the JSON Schema`);
          continue;
        }
        for (const [keyword, value] of Object.entries(expected)) {
          if (node[keyword] !== value) {
            missing.push(`${dotted}: expected ${keyword}=${value}, JSON Schema has ${node[keyword] ?? 'nothing'}`);
          }
        }
      }

      assert.deepEqual(
        missing,
        [],
        `the model is judged by limits it was never shown:\n  ${missing.join('\n  ')}`
      );
    });
  }
});
