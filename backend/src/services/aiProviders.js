// @ts-check
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

/**
 * One structured-JSON call, three vendors.
 *
 * The Proof Engine does not care who scores a piece of evidence — it cares that
 * the answer comes back matching a schema it can validate. Each provider below
 * takes the same request and returns raw text; everything else (retries,
 * validation, timing, falling back to the deterministic engine) is shared.
 *
 * Keeping this seam thin is what makes the engine portable: a key that runs out
 * of credit is a config change, not a rewrite.
 */

/**
 * Which vendor a key belongs to, read from its own prefix. Pasting a key is
 * enough — there is no second setting to keep in sync with it.
 */
export function detectProvider(apiKey = '') {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  // Google AI Studio issues two shapes: the long-standing AIza… and the newer AQ.…
  if (apiKey.startsWith('AIza') || apiKey.startsWith('AQ.')) return 'gemini';
  if (apiKey.startsWith('sk-')) return 'openai';
  return null;
}

/** Sensible default per vendor, used when AI_MODEL is unset or names another vendor's model. */
export const DEFAULT_MODELS = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-5',
  // 2.5 is closed to new API keys; 3.x flash is what a fresh free-tier key gets.
  gemini: 'gemini-3.6-flash',
};

/** A model belongs to the active provider only if its name looks like that vendor's. */
const MODEL_PATTERNS = {
  openai: /^(gpt|o\d)/i,
  anthropic: /^claude/i,
  gemini: /^gemini/i,
};

export function modelFor(provider) {
  const configured = env.ai.model?.trim();
  if (configured && MODEL_PATTERNS[provider]?.test(configured)) return configured;
  return DEFAULT_MODELS[provider];
}

/**
 * A rate limit and an empty wallet both arrive as 429, and confusing them wastes
 * an afternoon. A rate limit says when to come back — free tiers cap requests
 * per minute — so that phrasing is what separates them.
 */
function describeFailure(provider, status, message) {
  if (status === 401 || status === 403) {
    return `The ${provider} key was rejected (${status}). Check AI_API_KEY.`;
  }
  if (status === 429) {
    const retry = /retry in ([\d.]+)s/i.exec(message);
    if (retry) {
      return `${provider} is rate limited — retry in ${Math.ceil(Number(retry[1]))}s. Free tiers cap requests per minute.`;
    }
    return `The ${provider} account is out of quota. Add credit, or switch AI_API_KEY to another provider.`;
  }
  if (/quota|credit|billing|insufficient/i.test(message)) {
    return `The ${provider} account has no credit left. Add credit, or switch AI_API_KEY to another provider.`;
  }
  return message || `The ${provider} API call failed (${status}).`;
}

/** How long to wait before retrying, when the provider says so. */
function retryDelayMs(status, message) {
  if (status !== 429) return null;
  const retry = /retry in ([\d.]+)s/i.exec(message);
  // Free-tier windows are per minute, so an unspecified 429 waits one out.
  return retry ? Math.ceil(Number(retry[1]) * 1000) + 500 : 60000;
}

/**
 * A model call that never returns would hold a request open forever, so every
 * provider call carries a deadline. Past it, the deterministic engine answers —
 * which is the whole reason it exists.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 30000;

async function postJson(url, { headers, body, provider }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((cause) => {
    const message =
      cause?.name === 'TimeoutError'
        ? `${provider} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : `${provider} could not be reached: ${cause?.message ?? 'network error'}.`;
    throw new Error(message);
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.error?.description ?? '';
    /**
     * Carries the provider's own retry hint, so the caller can wait rather than
     * burn a retry on a window that has not reopened.
     * @type {Error & { status?: number, retryAfterMs?: number | null }}
     */
    const error = new Error(describeFailure(provider, response.status, message));
    error.status = response.status;
    error.retryAfterMs = retryDelayMs(response.status, message);
    throw error;
  }
  return payload;
}

/* ── OpenAI ─────────────────────────────────────────────────────────────── */

async function openaiComplete({ system, user, jsonSchema, model, maxTokens, name }) {
  const payload = await postJson('https://api.openai.com/v1/chat/completions', {
    provider: 'openai',
    headers: { Authorization: `Bearer ${env.ai.apiKey}` },
    body: {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        ...user.map((content) => ({ role: 'user', content })),
      ],
      // strict mode holds the model to the schema rather than hoping it complies.
      response_format: {
        type: 'json_schema',
        json_schema: { name, strict: true, schema: jsonSchema },
      },
    },
  });

  const choice = payload.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`The model declined this request: ${choice.message.refusal}`);
  return { text: choice?.message?.content ?? '', usage: payload.usage };
}

/* ── Anthropic ──────────────────────────────────────────────────────────── */

let anthropicClient = null;
async function anthropicComplete({ system, user, jsonSchema, model, maxTokens, effort }) {
  anthropicClient ??= new Anthropic({ apiKey: env.ai.apiKey, maxRetries: 1 });

  const response = await anthropicClient.beta.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: user.map((content) => ({ role: 'user', content })),
    output_config: { effort, format: { type: 'json_schema', schema: jsonSchema } },
    betas: ['structured-outputs-2025-11-13'],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`The model declined this request (${response.stop_details?.category ?? 'unspecified'}).`);
  }
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  return { text, usage: response.usage };
}

/* ── Gemini ─────────────────────────────────────────────────────────────── */

/**
 * Gemini rejects the JSON Schema keywords the other two accept, so the schema is
 * reshaped rather than sent as-is.
 */
function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== 'object') return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties') continue;
    if (key === 'type' && Array.isArray(value)) {
      // ['string','null'] is Gemini's `nullable`, not a union.
      out.type = value.find((entry) => entry !== 'null') ?? 'string';
      if (value.includes('null')) out.nullable = true;
      continue;
    }
    out[key] = toGeminiSchema(value);
  }
  return out;
}

async function geminiComplete({ system, user, jsonSchema, model, maxTokens }) {
  const payload = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      provider: 'gemini',
      headers: { 'x-goog-api-key': env.ai.apiKey },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: user.map((text) => ({ role: 'user', parts: [{ text }] })),
        generationConfig: {
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(jsonSchema),
        },
      },
    }
  );

  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text).join('') ?? '';
  return {
    text,
    usage: {
      input_tokens: payload.usageMetadata?.promptTokenCount,
      output_tokens: payload.usageMetadata?.candidatesTokenCount,
    },
  };
}

const PROVIDERS = {
  openai: openaiComplete,
  anthropic: anthropicComplete,
  gemini: geminiComplete,
};

export function completeWith(provider, request) {
  const complete = PROVIDERS[provider];
  if (!complete) throw new Error(`Unknown AI provider "${provider}".`);
  return complete(request);
}

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS);