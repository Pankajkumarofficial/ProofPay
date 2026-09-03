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

/**
 * The model-facing half of the Proof Engine.
 *
 * Everything vendor-specific lives in aiProviders.js. What stays here is what
 * makes a model answer trustworthy enough to show two people arguing over
 * money: the schema is enforced, a malformed answer is retried once with the
 * validation error fed back, and if it still fails this throws so the caller
 * can fall back to the deterministic engine. Nothing unvalidated is returned.
 */

/**
 * How long to wait before re-sending a request the provider failed to serve —
 * a 5xx, or a spike in demand. Long enough that an overloaded endpoint has
 * moved on, short enough that someone waiting on a click does not notice.
 *
 * It doubles per attempt, because "the model is experiencing high demand" is
 * rarely over in the same second: retrying immediately just spends an attempt
 * to be told the same thing. Callers with someone waiting take two attempts and
 * never feel the second delay; background callers take four and ride the spike
 * out.
 */
const TRANSIENT_RETRY_MS = 700;
const backoffMs = (attempt) => TRANSIENT_RETRY_MS * 2 ** (attempt - 1);

/**
 * A rate-limit window short enough to sit out even with someone watching.
 *
 * Falling back is meant to save a person from waiting a minute for a free-tier
 * window to reopen. It was doing it for three seconds — trading a moment of
 * spinner for a visibly worse answer, on a screen whose whole job is showing
 * what the engine understood. Under this, waiting is plainly the better deal.
 */
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

/**
 * What /api/ai/status and the UI badge report.
 *
 * A gateway is named by its host rather than by the word "gateway", and never
 * by the vendor whose wire format it borrows. Calling a reseller "openai"
 * because it speaks OpenAI's protocol would attribute a reading to a company
 * that never made it — which is the one thing every label in this app exists to
 * prevent.
 */
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
  maxTokens = MAX_OUTPUT_TOKENS,
  maxAttempts = 2,
  /**
   * Whether to sit out a provider's rate-limit window rather than fall back.
   *
   * Zero by default, because this is usually serving someone who just clicked a
   * button: waiting a minute for a free-tier window to reopen is far worse than
   * answering now with the deterministic engine and labelling it. Batch callers
   * with no one waiting — the eval harness — opt in.
   */
  maxRateLimitWaits = 0,
  /**
   * Whether anybody is waiting on this answer.
   *
   * It decides the two things that only make sense in terms of a person's
   * patience: how long a single call may take, and whether a call that timed
   * out is worth repeating. With someone watching a spinner, a second full
   * deadline is worse than a labelled fallback. With nobody watching, giving up
   * buys nothing and costs the real reading.
   */
  patient = false,
  timeoutMs = patient ? BACKGROUND_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
}) {
  const provider = activeProvider();
  if (!provider) throw new Error('No model provider is configured (AI_API_KEY is empty).');

  const model = modelFor(provider);
  /**
   * A vendor has a house model worth defaulting to. A gateway does not — its
   * catalogue is whatever it chose to resell, so an unnamed model would be sent
   * as an empty string and come back as a confusing 400 from a host whose docs
   * the reader does not have open.
   */
  if (!model) {
    throw new Error(
      `AI_MODEL must name a model when AI_BASE_URL points at a gateway (${gatewayHost() ?? env.ai.baseUrl}) — ` +
        'its catalogue is its own, so there is no default worth guessing.'
    );
  }
  const startedAt = Date.now();
  const turns = [prompt.user];
  let lastError = null;
  // A rate limit is not a bad answer — it is no answer yet. Waiting one out does
  // not consume an attempt, otherwise a free tier would look like a broken key.
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
        // The name that reaches the assessment record and the UI badge. A
        // gateway is its host, never the vendor whose protocol it borrows.
        engine: provider === 'gateway' ? gatewayHost() ?? 'gateway' : provider,
        model,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        usage,
      };
    } catch (error) {
      lastError = error;

      /**
       * A rate-limit window is the length the provider named, and asking again
       * sooner does not reopen it. An overload names no length at all — it only
       * says the model is busy — so each refusal doubles the wait rather than
       * asking the same busy machine at the same cadence.
       */
      const waitMs = error.overloaded
        ? error.retryAfterMs * 2 ** rateLimitWaits
        : error.retryAfterMs;

      // A brief window is worth sitting out once whoever is asking, which is why
      // this is not gated on the caller's patience budget alone.
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

      /**
       * Whether the model ever got a hearing. A timeout, an unreachable host or
       * an HTTP failure means no answer came back — as opposed to an answer that
       * came back malformed, which is the only kind worth arguing with.
       */
      const noAnswer = Boolean(error.transport || error.status);

      /**
       * A timeout or an unreachable host is worth another go only when nobody
       * is paying for the wait. Spending a second full deadline on someone
       * watching a spinner is worse than answering now from the deterministic
       * engine and labelling it — but in the background it is the difference
       * between the real reading and a weak one, so patience retries.
       */
      const abandonAfterNoAnswer = Boolean(error.transport) && !patient;

      // Nothing another attempt could change: a rejected key stays rejected, and
      // a rate-limit window this call will not wait out stays shut.
      if (
        abandonAfterNoAnswer ||
        error.retryAfterMs ||
        error.status === 401 ||
        error.status === 403 ||
        // 402: the request was priced and refused. Asking again unchanged costs
        // the same and is refused for the same reason.
        error.status === 402 ||
        attempt >= maxAttempts
      ) {
        break;
      }

      if (noAnswer) {
        // The provider failed, the request did not. Pause — an overloaded
        // endpoint retried in the same millisecond answers the same way — and
        // send it again exactly as it was.
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
