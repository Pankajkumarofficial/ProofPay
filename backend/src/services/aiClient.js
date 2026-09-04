import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  completeWith,
  detectProvider,
  modelFor,
  gatewayHost,
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_MS,
  BACKGROUND_TIMEOUT_MS,
} from './aiProviders.js';

/** The model-facing half of the Proof Engine. */

/** How long to wait before re-sending a request the provider failed to serve. */
const TRANSIENT_RETRY_MS = 700;
const backoffMs = (attempt) => TRANSIENT_RETRY_MS * 2 ** (attempt - 1);

/** A rate-limit window short enough to sit out even with someone watching. */
const SHORT_RATE_LIMIT_MS = 6000;

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
  if (!provider) return { engine: 'local-engine', model: null };
  if (provider === 'gateway') {
    return { engine: gatewayHost() ?? 'gateway', model: modelFor(provider) || null };
  }
  return { engine: provider, model: modelFor(provider) };
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

/** One structured judgement, validated before it is returned. */
export async function runStructured({
  prompt,
  jsonSchema,
  schema,
  name = 'proof_engine_result',
  effort = 'low',
  maxTokens = MAX_OUTPUT_TOKENS,
  maxAttempts = 2,
  /** Whether to sit out a provider's rate-limit window rather than fall back. */
  maxRateLimitWaits = 0,
  /** Whether anybody is waiting on this answer. */
  patient = false,
  timeoutMs = patient ? BACKGROUND_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
}) {
  const provider = activeProvider();
  if (!provider) throw new Error('No model provider is configured (AI_API_KEY is empty).');

  const model = modelFor(provider);
  /** A vendor has a house model worth defaulting to. */
  if (!model) {
    throw new Error(
      `AI_MODEL must name a model when AI_BASE_URL points at a gateway (${gatewayHost() ?? env.ai.baseUrl}) — ` +
        'its catalogue is its own, so there is no default worth guessing.'
    );
  }
  const startedAt = Date.now();
  const turns = [prompt.user];
  let lastError = null;
  // A rate limit is not a bad answer — it is no answer yet.
  let rateLimitWaits = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { text, usage } = await completeWith(provider, {
        system: prompt.system,
        user: turns,
        // The artefact itself, when the proof came with one to read.
        attachments: prompt.attachments ?? [],
        timeoutMs,
        jsonSchema,
        model,
        maxTokens,
        effort,
        name,
      });

      const parsed = schema.parse(extractJson(text));
      return {
        data: parsed,
        // The name that reaches the assessment record and the UI badge.
        engine: provider === 'gateway' ? gatewayHost() ?? 'gateway' : provider,
        model,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        usage,
      };
    } catch (error) {
      lastError = error;

      /** A rate-limit window is the length the provider named, and asking again sooner does not reopen it. */
      const waitMs = error.overloaded
        ? error.retryAfterMs * 2 ** rateLimitWaits
        : error.retryAfterMs;

      // A brief window is worth sitting out once whoever is asking.
      const briefWindow = waitMs <= SHORT_RATE_LIMIT_MS && rateLimitWaits === 0;
      if (error.retryAfterMs && (rateLimitWaits < maxRateLimitWaits || briefWindow)) {
        rateLimitWaits += 1;
        const seconds = Math.max(1, Math.round(waitMs / 1000));
        // Naming the wrong cause here sends someone to check a key that is fine.
        logger.warn(
          error.overloaded
            ? `Proof Engine overloaded; waiting ${seconds}s.`
            : `Proof Engine rate limited; waiting ${seconds}s.`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        attempt -= 1; // the request never got a hearing
        continue;
      }

      logger.warn(`Proof Engine attempt ${attempt} failed: ${error.message}`);

      /** Whether the model ever got a hearing. */
      const noAnswer = Boolean(error.transport || error.status);

      /** A timeout or an unreachable host is worth another go only when nobody is paying for the wait. */
      const abandonAfterNoAnswer = Boolean(error.transport) && !patient;

      // Nothing another attempt could change.
      if (
        abandonAfterNoAnswer ||
        error.retryAfterMs ||
        error.status === 401 ||
        error.status === 403 ||
        // 402: the request was priced and refused.
        error.status === 402 ||
        attempt >= maxAttempts
      ) {
        break;
      }

      if (noAnswer) {
        // The provider failed, the request did not.
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
      } else {
        turns.push(
          `Your previous response was rejected by validation: ${error.message}\n` +
            'Return a corrected JSON object that satisfies the schema exactly. JSON only.'
        );
      }
    }
  }
  throw lastError ?? new Error('The Proof Engine returned no usable response.');
}
