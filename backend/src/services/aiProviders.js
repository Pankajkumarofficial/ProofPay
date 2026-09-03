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
  // A gateway is chosen by its URL, not by the key — every one of them issues
  // `sk-…`, so the prefix below would call all of them OpenAI.
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

/**
 * A model belongs to the active provider only if its name looks like that
 * vendor's — except on a gateway, whose catalogue is whatever it chose to
 * resell. Guessing a naming convention there would reject valid models, so the
 * only rule is that one must be named.
 */
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

/**
 * An overloaded model is not a broken one.
 *
 * 503 — and Anthropic's 529 — mean the provider took the request and had no
 * capacity for it: "not now", not "no". It is the one failure a longer wait
 * genuinely fixes, and the one the generic transient path handles worst. At
 * 700ms the same busy machine gives the same answer, three attempts land inside
 * two seconds, and a case the model could have answered is recorded as one it
 * could not. Providers phrase it differently, so the status decides and the
 * wording is only a fallback for a 5xx that does not use the conventional code.
 */
const OVERLOADED_STATUS = new Set([503, 529]);
const OVERLOAD_WORDING = /high demand|overloaded|currently unavailable|try again later/i;

function isOverloaded(status, message = '') {
  return OVERLOADED_STATUS.has(status) || (status >= 500 && OVERLOAD_WORDING.test(message));
}

/**
 * A rate limit and an empty wallet both arrive as 429, and confusing them wastes
 * an afternoon. A rate limit says when to come back — free tiers cap requests
 * per minute — so that phrasing is what separates them.
 */
function describeFailure(provider, status, message) {
  // A gateway is named by its host; "the gateway key was rejected" tells the
  // reader nothing about which account to go and look at.
  if (provider === 'gateway') provider = gatewayHost() ?? 'the gateway';
  if (status === 401 || status === 403) {
    /**
     * `sk-` is the catch-all in detectProvider, and it is not OpenAI's alone —
     * DeepSeek, Groq, Together, Mistral and OpenRouter all issue keys that start
     * the same way. So a rejection here has two very different causes wearing
     * one status code: a bad OpenAI key, or a good key for a vendor this never
     * asked. The second is invisible unless the message says the provider was a
     * guess, because everything else in the app reports it as settled fact.
     */
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
  /**
   * 402 is the request being priced and refused, which is not the same as an
   * empty account — and the difference is the whole remedy. The provider's own
   * sentence carries both numbers (what was asked for, what is affordable) and
   * says the request can also be made smaller. Replacing it with "add credit"
   * discards the numbers and half the fix, and sends someone to a billing page
   * when lowering `AI_MAX_TOKENS` would have done.
   */
  if (status === 402) return `${provider} refused the request: ${message}`;
  /**
   * Restricted to the statuses that actually mean money. Left open to any
   * status, this matched the word "credit" anywhere in any provider error and
   * reported a funding problem for something else entirely.
   */
  if (status === 429 && /quota|credit|billing|insufficient/i.test(message)) {
    return `The ${provider} account has no credit left. Add credit, or switch AI_API_KEY to another provider.`;
  }
  return message || `The ${provider} API call failed (${status}).`;
}

/**
 * A window this call should sit out rather than spend an attempt on.
 *
 * Both answers here mean "no answer yet". The difference is who chose the
 * length: a 429 carries the provider's own window, while an overload carries
 * none, so the caller escalates its own — the provider has told us it is busy,
 * not for how long.
 */
const OVERLOAD_RETRY_MS = Number(process.env.AI_OVERLOAD_RETRY_MS) || 5000;

function retryDelayMs(status, message) {
  if (isOverloaded(status, message)) return OVERLOAD_RETRY_MS;
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
/**
 * The ceiling on one answer.
 *
 * Every contract here is small — the largest is a dispute report, and even its
 * worst case is a few thousand tokens. The ceiling exists to stop a runaway
 * generation, not to describe an expected size, which is why it can sit well
 * above what any schema needs. It is tunable because some accounts are billed
 * against the ceiling rather than the tokens actually produced, and are refused
 * for asking too high even when the answer would have been short.
 */
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

/**
 * OpenAI takes images as data URLs and PDFs as a `file` part.
 *
 * The PDF case is not decoration. Dropping it silently is incident 1 exactly:
 * the artefact never reaches the model, the system prompt caps confidence at 60
 * because the contents were not provided, and the interface reports a reading of
 * a document nobody read. That failure came back the moment a gateway made this
 * the active path for a Claude model, which reads PDFs perfectly well — the
 * limitation was never the model's.
 */
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
                // The name is required by the format and is not load-bearing:
                // the bytes are what gets read.
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
  // A gateway speaks this wire format at an address of its own. Everything
  // below is identical; only where it is sent, and what it is called, differ.
  provider = 'openai',
  endpoint = 'https://api.openai.com/v1/chat/completions',
  /**
   * Whether this endpoint reads a PDF sent as a `file` part.
   *
   * OpenAI documents it. A gateway may accept it, ignore it in silence, or
   * reject the request — and the silent case is indistinguishable from success
   * until someone notices the engine quoting a filename. So it is sent only
   * where it is known to work, and every other endpoint gets the PDF as text
   * extracted before the call.
   */
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

/**
 * The same OpenAI request, sent where AI_BASE_URL points.
 *
 * The gateway is not a fourth vendor integration — it is the OpenAI one with a
 * different address and an honest name, which is the whole reason the wire
 * format is worth standardising on.
 */
/**
 * The schema, restated where a gateway cannot ignore it.
 *
 * OpenAI's `response_format: json_schema` with `strict: true` is a guarantee:
 * the answer comes back matching, or it does not come back. A gateway forwards
 * what it chooses to, and this one accepts the field, answers HTTP 200, and
 * replies in prose — the guarantee is silently absent, and the response says
 * nothing about it.
 *
 * The retry loop does catch it, because validation happens before anything is
 * returned. But it catches it by spending a second slow call to say "your
 * previous response was rejected", on every request, forever. Putting the schema
 * in the prompt asks for the right shape the first time, and costs nothing where
 * the field is honoured anyway.
 */
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
    // The gateway accepts `response_format` and does not honour it, so the
    // schema has to travel in the one field that always reaches the model.
    system: withSchemaInstruction(request.system, request.jsonSchema),
    // The host, not the word "gateway" — every message built from this names
    // something the reader can go and look at.
    provider: gatewayHost() ?? 'the gateway',
    endpoint: `${env.ai.baseUrl}/chat/completions`,
    // Unknown by definition: a gateway is whatever someone put behind a URL.
    // The PDF still reaches it, as text pulled out before the call.
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