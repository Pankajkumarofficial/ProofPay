// @ts-check
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

/** One structured-JSON call, three vendors. */

/** Which vendor a key belongs to, read from its own prefix. */
export function detectProvider(apiKey = '') {
  // A gateway is chosen by its URL, not by the key.
  if (env.ai.baseUrl) return 'gateway';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  // Google AI Studio issues two shapes: the long-standing AIza… and the newer AQ.…
  if (apiKey.startsWith('AIza') || apiKey.startsWith('AQ.')) return 'gemini';
  if (apiKey.startsWith('sk-')) return 'openai';
  return null;
}

/** The host serving a gateway, used to label a reading with where it came from. */
export function gatewayHost() {
  if (!env.ai.baseUrl) return null;
  try {
    return new URL(env.ai.baseUrl).host;
  } catch {
    return null;
  }
}

/** Sensible default per vendor, used when AI_MODEL is unset or names another vendor's model. */
export const DEFAULT_MODELS = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-5',
  // 2.5 is closed to new API keys; 3.x flash is what a fresh free-tier key gets.
  gemini: 'gemini-3.6-flash',
  // A gateway's catalogue is its own, so there is nothing sensible to guess.
  gateway: '',
};

/** A model belongs to the active provider only if its name looks like that vendor's. */
const MODEL_PATTERNS = {
  openai: /^(gpt|o\d)/i,
  anthropic: /^claude/i,
  gemini: /^gemini/i,
  gateway: /./,
};

export function modelFor(provider) {
  const configured = env.ai.model?.trim();
  if (configured && MODEL_PATTERNS[provider]?.test(configured)) return configured;
  return DEFAULT_MODELS[provider];
}

/** An overloaded model is not a broken one. */
const OVERLOADED_STATUS = new Set([503, 529]);
const OVERLOAD_WORDING = /high demand|overloaded|currently unavailable|try again later/i;

function isOverloaded(status, message = '') {
  return OVERLOADED_STATUS.has(status) || (status >= 500 && OVERLOAD_WORDING.test(message));
}

/** A rate limit and an empty wallet both arrive as 429, and confusing them wastes an afternoon. */
function describeFailure(provider, status, message) {
  // A gateway is named by its host.
  if (provider === 'gateway') provider = gatewayHost() ?? 'the gateway';
  if (status === 401 || status === 403) {
    /** `sk-` is the catch-all in detectProvider, and it is not OpenAI's alone. */
    const guessed = (!env.ai.provider || env.ai.provider === 'auto') && provider === 'openai';
    return (
      `The ${provider} key was rejected (${status}). Check AI_API_KEY.` +
      (guessed
        ? ` The provider was inferred from the key starting "sk-", which several vendors use —` +
          ` if this is not an OpenAI key, set AI_PROVIDER to the vendor it belongs to.`
        : '')
    );
  }
  if (isOverloaded(status, message)) {
    return `${provider} is overloaded (${status}) and did not take the request — this is temporary, and not a problem with the key or the prompt.`;
  }
  if (status === 429) {
    const retry = /retry in ([\d.]+)s/i.exec(message);
    if (retry) {
      return `${provider} is rate limited — retry in ${Math.ceil(Number(retry[1]))}s. Free tiers cap requests per minute.`;
    }
    return `The ${provider} account is out of quota. Add credit, or switch AI_API_KEY to another provider.`;
  }
  /** 402 is the request being priced and refused, which is not the same as an empty account. */
  if (status === 402) return `${provider} refused the request: ${message}`;
  /** Restricted to the statuses that actually mean money. */
  if (status === 429 && /quota|credit|billing|insufficient/i.test(message)) {
    return `The ${provider} account has no credit left. Add credit, or switch AI_API_KEY to another provider.`;
  }
  return message || `The ${provider} API call failed (${status}).`;
}

/** A window this call should sit out rather than spend an attempt on. */
const OVERLOAD_RETRY_MS = Number(process.env.AI_OVERLOAD_RETRY_MS) || 5000;

function retryDelayMs(status, message) {
  if (isOverloaded(status, message)) return OVERLOAD_RETRY_MS;
  if (status !== 429) return null;
  const retry = /retry in ([\d.]+)s/i.exec(message);
  // Free-tier windows are per minute, so an unspecified 429 waits one out.
  return retry ? Math.ceil(Number(retry[1]) * 1000) + 500 : 60000;
}

/** A model call that never returns would hold a request open forever. */
/** The ceiling on one answer. */
export const MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_TOKENS) || 16000;

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
     * burn a retry on a window that has not reopened. `overloaded` separates a
     * window the provider named from one it did not, which is what decides
     * whether the caller may lengthen it.
     * @type {Error & { status?: number, retryAfterMs?: number | null, overloaded?: boolean }}
     */
    const error = new Error(describeFailure(provider, response.status, message));
    error.status = response.status;
    error.retryAfterMs = retryDelayMs(response.status, message);
    error.overloaded = isOverloaded(response.status, message);
    throw error;
  }
  return payload;
}

/* ── Attachments ────────────────────────────────────────────────────────── */

/** Proof is usually a picture: a screenshot of a transfer, a photo of the work, a scanned receipt. */
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;
const PDF_MIME = 'application/pdf';

/** Only the first turn carries the artefact — a retry is a correction, not a resend. */
const onFirstTurn = (turns, attachments, build) =>
  turns.map((text, index) => (index === 0 && attachments.length ? build(text, attachments) : text));

/* ── OpenAI ─────────────────────────────────────────────────────────────── */

/** OpenAI takes images as data URLs and PDFs as a `file` part. */
const openaiPartsWith = ({ nativePdf }) =>
  function openaiParts(text, attachments) {
    return [
      { type: 'text', text },
      ...attachments.flatMap((file) => {
        if (IMAGE_MIME.test(file.mimeType)) {
          return [
            { type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.data}` } },
          ];
        }
        if (file.mimeType === PDF_MIME && nativePdf) {
          return [
            {
              type: 'file',
              file: {
                // The name is required by the format and is not load-bearing: the bytes are what gets read.
                filename: file.filename ?? 'artefact.pdf',
                file_data: `data:${PDF_MIME};base64,${file.data}`,
              },
            },
          ];
        }
        return [];
      }),
    ];
  };

async function openaiComplete({
  system,
  user,
  attachments = [],
  jsonSchema,
  model,
  maxTokens,
  name,
  timeoutMs,
  // A gateway speaks this wire format at an address of its own.
  provider = 'openai',
  endpoint = 'https://api.openai.com/v1/chat/completions',
  /** Whether this endpoint reads a PDF sent as a `file` part. */
  nativePdf = true,
}) {
  const payload = await postJson(endpoint, {
    provider,
    timeoutMs,
    headers: { Authorization: `Bearer ${env.ai.apiKey}` },
    body: {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        ...onFirstTurn(user, attachments, openaiPartsWith({ nativePdf })).map((content) => ({
          role: 'user',
          content,
        })),
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

/** Gemini rejects the JSON Schema keywords the other two accept. */
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

/** Gemini carries both images and PDFs as inline data. */
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

/** The same OpenAI request, sent where AI_BASE_URL points. */
/** The schema, restated where a gateway cannot ignore it. */
function withSchemaInstruction(system, jsonSchema) {
  if (!jsonSchema) return system;
  return (
    `${system}\n\n` +
    'Return ONLY a single JSON object — no prose before or after it, and no code fences. ' +
    'It must match this JSON Schema, and every name listed under "required" must be present:\n' +
    JSON.stringify(jsonSchema)
  );
}

const gatewayComplete = (request) =>
  openaiComplete({
    ...request,
    // The gateway accepts `response_format` and does not honour it.
    system: withSchemaInstruction(request.system, request.jsonSchema),
    // The host, not the word "gateway".
    provider: gatewayHost() ?? 'the gateway',
    endpoint: `${env.ai.baseUrl}/chat/completions`,
    // Unknown by definition: a gateway is whatever someone put behind a URL.
    nativePdf: false,
  });

const PROVIDERS = {
  openai: openaiComplete,
  anthropic: anthropicComplete,
  gemini: geminiComplete,
  gateway: gatewayComplete,
};

export function completeWith(provider, request) {
  const complete = PROVIDERS[provider];
  if (!complete) throw new Error(`Unknown AI provider "${provider}".`);
  return complete(request);
}

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS);