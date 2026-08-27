import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let client = null;
function getClient() {
  if (!env.ai.enabled) return null;
  if (!client) client = new Anthropic({ apiKey: env.ai.apiKey, maxRetries: 1 });
  return client;
}

export const isClaudeEnabled = () => Boolean(getClient());

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
 * Calls Claude for one structured judgement and returns data that has passed the
 * caller's Zod schema. Malformed output is retried once with the validation error
 * fed back; if it still fails, this throws and the caller falls back to the
 * deterministic engine. Nothing unvalidated is ever returned.
 */
export async function runStructured({
  prompt,
  jsonSchema,
  schema,
  effort = 'low',
  maxTokens = 16000,
  maxAttempts = 2,
}) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('Claude is not configured (AI_API_KEY is empty).');

  const startedAt = Date.now();
  const messages = [{ role: 'user', content: prompt.user }];
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await anthropic.beta.messages.create({
        model: env.ai.model,
        max_tokens: maxTokens,
        system: prompt.system,
        messages,
        output_config: {
          effort,
          format: { type: 'json_schema', schema: jsonSchema },
        },
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

      const parsed = schema.parse(extractJson(text));
      return {
        data: parsed,
        engine: 'claude',
        model: env.ai.model,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        usage: response.usage,
      };
    } catch (error) {
      lastError = error;
      logger.warn(`Proof Engine attempt ${attempt} failed: ${error.message}`);
      if (attempt < maxAttempts) {
        messages.push(
          { role: 'assistant', content: 'I will return corrected JSON.' },
          {
            role: 'user',
            content: `Your previous response was rejected by validation: ${error.message}\nReturn a corrected JSON object that satisfies the schema exactly. JSON only.`,
          }
        );
      }
    }
  }
  throw lastError ?? new Error('The Proof Engine returned no usable response.');
}
