import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { completeWith, detectProvider, modelFor } from './aiProviders.js';

/**
 * The model-facing half of the Proof Engine.
 *
 * Everything vendor-specific lives in aiProviders.js. What stays here is what
 * makes a model answer trustworthy enough to show two people arguing over
 * money: the schema is enforced, a malformed answer is retried once with the
 * validation error fed back, and if it still fails this throws so the caller
 * can fall back to the deterministic engine. Nothing unvalidated is returned.
 */

/** The active vendor, or null when no key is set and the local engine runs alone. */
export function activeProvider() {
  if (!env.ai.enabled) return null;
  const configured = env.ai.provider;
  if (configured && configured !== 'auto') return configured;
  return detectProvider(env.ai.apiKey);
}

export const isModelEngineEnabled = () => Boolean(activeProvider());

/** Kept under its old name so existing callers read the same. */
export const isClaudeEnabled = isModelEngineEnabled;

/** What /api/ai/status and the UI badge report. */
export function engineDescriptor() {
  const provider = activeProvider();
  return provider
    ? { engine: provider, model: modelFor(provider) }
    : { engine: 'local-engine', model: null };
}

/** Pulls the first JSON object out of a response, tolerating stray prose or fences. */
export function extractJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON object found in the model response.');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/**
 * One structured judgement, validated before it is returned.
 *
 * `engine` in the result is the provider that actually answered — the interface
 * shows it on every assessment, so a reading is never attributed to a model
 * that did not produce it.
 */
export async function runStructured({
  prompt,
  jsonSchema,
  schema,
  name = 'proof_engine_result',
  effort = 'low',
  maxTokens = 16000,
  maxAttempts = 2,
}) {
  const provider = activeProvider();
  if (!provider) throw new Error('No model provider is configured (AI_API_KEY is empty).');

  const model = modelFor(provider);
  const startedAt = Date.now();
  const turns = [prompt.user];
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { text, usage } = await completeWith(provider, {
        system: prompt.system,
        user: turns,
        jsonSchema,
        model,
        maxTokens,
        effort,
        name,
      });

      const parsed = schema.parse(extractJson(text));
      return {
        data: parsed,
        engine: provider,
        model,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        usage,
      };
    } catch (error) {
      lastError = error;
      logger.warn(`Proof Engine attempt ${attempt} failed: ${error.message}`);
      if (attempt < maxAttempts) {
        turns.push(
          `Your previous response was rejected by validation: ${error.message}\n` +
            'Return a corrected JSON object that satisfies the schema exactly. JSON only.'
        );
      }
    }
  }
  throw lastError ?? new Error('The Proof Engine returned no usable response.');
}
