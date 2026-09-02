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
 *
 * The right deadline depends on who is waiting. Thirty seconds is a person's
 * patience, not a model's speed: a judgement made while someone watches a
 * spinner has to give up around there. A judgement made in the background has
 * nobody to keep waiting, and a reading that arrives late is worth far more
 * than one that gave up early — so those get a much longer rope.
 */
export const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 30000;
export const BACKGROUND_TIMEOUT_MS = Number(process.env.AI_BACKGROUND_TIMEOUT_MS) || 90000;

async function postJson(url, { headers, body, provider, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((cause) => {
    const timedOut = cause?.name === 'TimeoutError';
    /**
     * Tagged so the caller can tell "no answer" from "a bad answer". Nothing
     * came back, so there is nothing to correct and nothing to feed back.
     * @type {Error & { transport?: string }}
     */
    const error = new Error(
      timedOut
        ? `${provider} did not respond within ${Math.max(1, Math.round(timeoutMs / 1000))}s.`
        : `${provider} could not be reached: ${cause?.message ?? 'network error'}.`
    );
    error.transport = timedOut ? 'timeout' : 'network';
    throw error;
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

/* ── Attachments ────────────────────────────────────────────────────────── */

/**
 * Proof is usually a picture: a screenshot of a transfer, a photo of the work,
 * a scanned receipt. Sent as a file name it proves nothing, so the bytes ride
 * along with the first user turn and the model reads the artefact itself.
 * Each vendor wants them in its own shape; the caller passes the same
 * `{ mimeType, data }` either way.
 */
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;
const PDF_MIME = 'application/pdf';

/** Only the first turn carries the artefact — a retry is a correction, not a resend. */
const onFirstTurn = (turns, attachments, build) =>
  turns.map((text, index) => (index === 0 && attachments.length ? build(text, attachments) : text));

/* ── OpenAI ─────────────────────────────────────────────────────────────── */

/** OpenAI takes images as data URLs; it has no inline shape for a PDF. */
const openaiParts = (text, attachments) => [
  { type: 'text', text },
  ...attachments
    .filter((file) => IMAGE_MIME.test(file.mimeType))
    .map((file) => ({ type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.data}` } })),
];

async function openaiComplete({ system, user, attachments = [], jsonSchema, model, maxTokens, name, timeoutMs }) {
  const payload = await postJson('https://api.openai.com/v1/chat/completions', {
    provider: 'openai',
    timeoutMs,
    headers: { Authorization: `Bearer ${env.ai.apiKey}` },
    body: {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        ...onFirstTurn(user, attachments, openaiParts).map((content) => ({ role: 'user', content })),
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

/** Anthropic reads a PDF as a document block and everything else as an image. */
const anthropicBlocks = (text, attachments) => [
  ...attachments.map((file) =>
    file.mimeType === PDF_MIME
      ? { type: 'document', source: { type: 'base64', media_type: PDF_MIME, data: file.data } }
      : { type: 'image', source: { type: 'base64', media_type: file.mimeType, data: file.data } }
  ),
  // The artefact goes before the question it is being asked about.
  { type: 'text', text },
];

let anthropicClient = null;
async function anthropicComplete({ system, user, attachments = [], jsonSchema, model, maxTokens, effort, timeoutMs }) {
  anthropicClient ??= new Anthropic({ apiKey: env.ai.apiKey, maxRetries: 1 });

  const response = await anthropicClient.beta.messages.create(
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: onFirstTurn(user, attachments, anthropicBlocks).map((content) => ({ role: 'user', content })),
      output_config: { effort, format: { type: 'json_schema', schema: jsonSchema } },
      betas: ['structured-outputs-2025-11-13'],
    },
    // The SDK carries its own deadline; it has to match the one the caller chose.
    timeoutMs ? { timeout: timeoutMs } : undefined
  );

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

/**
 * Gemini carries both images and PDFs as inline data. The text stays the first
 * part, so a turn always reads the same way whether or not a file came with it.
 */
const geminiParts = (text, attachments) => [
  { text },
  ...attachments.map((file) => ({ inline_data: { mime_type: file.mimeType, data: file.data } })),
];

async function geminiComplete({ system, user, attachments = [], jsonSchema, model, maxTokens, timeoutMs }) {
  const payload = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      provider: 'gemini',
      timeoutMs,
      headers: { 'x-goog-api-key': env.ai.apiKey },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: user.map((text, index) => ({
          role: 'user',
          parts: index === 0 && attachments.length ? geminiParts(text, attachments) : [{ text }],
        })),
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