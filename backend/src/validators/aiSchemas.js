import { z } from 'zod';
import { CONDITION_TYPE, VERIFICATION_METHOD, VERDICT } from '../models/constants.js';

/**
 * Contracts for everything the Proof Engine returns.
 *
 * Each contract exists twice on purpose: as a JSON Schema handed to the model so
 * it constrains generation, and as a Zod schema used to validate the response
 * before a single field touches MongoDB. The model's output is never trusted.
 */

const conditionTypes = Object.values(CONDITION_TYPE);
const verificationMethods = Object.values(VERIFICATION_METHOD);

const ambiguitySchema = z.object({
  phrase: z.string().min(1).max(200),
  reason: z.string().min(1).max(400),
  suggestions: z.array(z.string().min(1).max(160)).max(6).default([]),
});

export const parsedPromiseSchema = z.object({
  title: z.string().min(3).max(140),
  amount: z.number().positive().max(1_000_000_000).nullable(),
  currency: z.string().length(3).toUpperCase().default('INR'),
  recipient: z.string().max(80).nullable(),
  purpose: z.string().max(300).default(''),
  outcome: z.string().max(500).default(''),
  deadline: z.string().nullable().default(null),
  conditions: z
    .array(
      z.object({
        description: z.string().min(3).max(500),
        type: z.enum(conditionTypes).catch(CONDITION_TYPE.DELIVERABLE),
        verificationMethod: z.enum(verificationMethods).catch(VERIFICATION_METHOD.AI_ASSESSMENT),
        requiredEvidence: z.array(z.string().min(1).max(160)).max(5).default([]),
      })
    )
    .min(1)
    .max(12),
  ambiguities: z.array(ambiguitySchema).max(8).default([]),
});

export const parsedPromiseJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    amount: { type: ['number', 'null'] },
    currency: { type: 'string' },
    recipient: { type: ['string', 'null'] },
    purpose: { type: 'string' },
    outcome: { type: 'string' },
    deadline: { type: ['string', 'null'] },
    conditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          type: { type: 'string', enum: conditionTypes },
          verificationMethod: { type: 'string', enum: verificationMethods },
          requiredEvidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['description', 'type', 'verificationMethod', 'requiredEvidence'],
        additionalProperties: false,
      },
    },
    ambiguities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phrase: { type: 'string' },
          reason: { type: 'string' },
          suggestions: { type: 'array', items: { type: 'string' } },
        },
        required: ['phrase', 'reason', 'suggestions'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'title',
    'amount',
    'currency',
    'recipient',
    'purpose',
    'outcome',
    'deadline',
    'conditions',
    'ambiguities',
  ],
  additionalProperties: false,
};

export const ambiguityReportSchema = z.object({
  clarityScore: z.number().min(0).max(100),
  ambiguities: z.array(ambiguitySchema).max(10).default([]),
});

export const ambiguityReportJsonSchema = {
  type: 'object',
  properties: {
    clarityScore: { type: 'number' },
    ambiguities: parsedPromiseJsonSchema.properties.ambiguities,
  },
  required: ['clarityScore', 'ambiguities'],
  additionalProperties: false,
};

export const evidenceAssessmentSchema = z.object({
  verdict: z.enum(Object.values(VERDICT)),
  confidence: z.number().min(0).max(100),
  explanation: z.string().min(1).max(900),
  contradictions: z.array(z.string().max(300)).max(6).default([]),
  missingEvidence: z.array(z.string().max(200)).max(6).default([]),
});

export const evidenceAssessmentJsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: Object.values(VERDICT) },
    confidence: { type: 'number' },
    explanation: { type: 'string' },
    contradictions: { type: 'array', items: { type: 'string' } },
    missingEvidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'confidence', 'explanation', 'contradictions', 'missingEvidence'],
  additionalProperties: false,
};

export const disputeReportSchema = z.object({
  summary: z.string().min(1).max(1200),
  fulfilledConditions: z.array(z.string().max(300)).max(20).default([]),
  contestedConditions: z.array(z.string().max(300)).max(20).default([]),
  missingProof: z.array(z.string().max(300)).max(20).default([]),
  contradictions: z.array(z.string().max(300)).max(20).default([]),
  recommendation: z.string().min(1).max(900),
  recommendedOutcome: z.enum(['release_full', 'release_partial', 'hold', 'refund', 'needs_more_proof']),
  confidence: z.number().min(0).max(100),
});

export const disputeReportJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    fulfilledConditions: { type: 'array', items: { type: 'string' } },
    contestedConditions: { type: 'array', items: { type: 'string' } },
    missingProof: { type: 'array', items: { type: 'string' } },
    contradictions: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
    recommendedOutcome: {
      type: 'string',
      enum: ['release_full', 'release_partial', 'hold', 'refund', 'needs_more_proof'],
    },
    confidence: { type: 'number' },
  },
  required: [
    'summary',
    'fulfilledConditions',
    'contestedConditions',
    'missingProof',
    'contradictions',
    'recommendation',
    'recommendedOutcome',
    'confidence',
  ],
  additionalProperties: false,
};

export const explanationSchema = z.object({
  headline: z.string().min(1).max(80),
  explanation: z.string().min(1).max(600),
  nextAction: z.string().max(200).nullable().default(null),
});

export const explanationJsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    explanation: { type: 'string' },
    nextAction: { type: ['string', 'null'] },
  },
  required: ['headline', 'explanation', 'nextAction'],
  additionalProperties: false,
};
