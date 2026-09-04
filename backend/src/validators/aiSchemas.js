import { z } from 'zod';
import { CONDITION_TYPE, VERIFICATION_METHOD, VERDICT } from '../models/constants.js';

/** Contracts for everything the Proof Engine returns. */

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
    title: { type: 'string', minLength: 3, maxLength: 140 },
    amount: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 1000000000 },
    currency: { type: 'string', minLength: 3, maxLength: 3 },
    recipient: { type: ['string', 'null'], maxLength: 80 },
    purpose: { type: 'string', maxLength: 300 },
    outcome: { type: 'string', maxLength: 500 },
    deadline: { type: ['string', 'null'] },
    conditions: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', minLength: 3, maxLength: 500 },
          type: { type: 'string', enum: conditionTypes },
          verificationMethod: { type: 'string', enum: verificationMethods },
          requiredEvidence: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
        required: ['description', 'type', 'verificationMethod', 'requiredEvidence'],
        additionalProperties: false,
      },
    },
    ambiguities: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          phrase: { type: 'string', minLength: 1, maxLength: 200 },
          reason: { type: 'string', minLength: 1, maxLength: 400 },
          suggestions: {
            type: 'array',
            maxItems: 6,
            items: { type: 'string', minLength: 1, maxLength: 160 },
          },
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
    clarityScore: { type: 'number', minimum: 0, maximum: 100 },
    // Same item shape, a different cap on how many.
    ambiguities: { ...parsedPromiseJsonSchema.properties.ambiguities, maxItems: 10 },
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
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    explanation: { type: 'string', minLength: 1, maxLength: 900 },
    contradictions: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 300 } },
    missingEvidence: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 200 } },
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
    summary: { type: 'string', minLength: 1, maxLength: 1200 },
    fulfilledConditions: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
    contestedConditions: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
    missingProof: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
    contradictions: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
    recommendation: { type: 'string', minLength: 1, maxLength: 900 },
    recommendedOutcome: {
      type: 'string',
      enum: ['release_full', 'release_partial', 'hold', 'refund', 'needs_more_proof'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
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
    headline: { type: 'string', minLength: 1, maxLength: 80 },
    explanation: { type: 'string', minLength: 1, maxLength: 600 },
    nextAction: { type: ['string', 'null'], maxLength: 200 },
  },
  required: ['headline', 'explanation', 'nextAction'],
  additionalProperties: false,
};
