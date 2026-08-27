import { z } from 'zod';
import mongoose from 'mongoose';
import {
  CURRENCIES,
  CONDITION_TYPE,
  VERIFICATION_METHOD,
  EVIDENCE_TYPE,
  CONDITION_STATUS,
  PROMISE_STATUS,
} from '../models/constants.js';

export const objectId = z
  .string()
  .refine((value) => mongoose.Types.ObjectId.isValid(value), 'That identifier does not look right.');

const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'That password is too long.')
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
    message: 'Include at least one letter and one number.',
  });

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Tell us your name.').max(80),
    email: z.string().trim().toLowerCase().email('That email does not look right.'),
    password,
    confirmPassword: z.string().optional(),
  })
  .refine((data) => !data.confirmPassword || data.confirmPassword === data.password, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('That email does not look right.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  avatar: z.string().url().max(500).nullable().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: password,
});

const conditionInput = z.object({
  description: z.string().trim().min(3, 'Describe the condition.').max(500),
  type: z.enum(Object.values(CONDITION_TYPE)).default(CONDITION_TYPE.DELIVERABLE),
  verificationMethod: z
    .enum(Object.values(VERIFICATION_METHOD))
    .default(VERIFICATION_METHOD.AI_ASSESSMENT),
  requiredEvidence: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
  weight: z.number().min(0.1).max(5).default(1),
});

export const createPromiseSchema = z.object({
  title: z.string().trim().min(3, 'Give this promise a title.').max(140),
  description: z.string().trim().max(4000).default(''),
  sourceText: z.string().trim().max(4000).default(''),
  purpose: z.string().trim().max(300).default(''),
  outcome: z.string().trim().max(500).default(''),
  amount: z.number({ invalid_type_error: 'Enter an amount.' }).positive('Enter an amount above zero.').max(1_000_000_000),
  currency: z.enum(CURRENCIES).default('INR'),
  recipient: z.object({
    name: z.string().trim().min(2, 'Who is being paid?').max(80),
    email: z.string().trim().toLowerCase().email('That email does not look right.').optional().nullable(),
  }),
  deadline: z.coerce.date().nullable().optional(),
  conditions: z.array(conditionInput).min(1, 'A promise needs at least one condition.').max(12),
  ambiguityFlags: z
    .array(
      z.object({
        phrase: z.string().max(200),
        reason: z.string().max(400),
        suggestions: z.array(z.string().max(160)).max(6).default([]),
        resolved: z.boolean().default(false),
      })
    )
    .max(8)
    .default([]),
});

export const updatePromiseSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  description: z.string().trim().max(4000).optional(),
  outcome: z.string().trim().max(500).optional(),
  amount: z.number().positive().max(1_000_000_000).optional(),
  currency: z.enum(CURRENCIES).optional(),
  deadline: z.coerce.date().nullable().optional(),
  recipient: z
    .object({
      name: z.string().trim().min(2).max(80).optional(),
      email: z.string().trim().toLowerCase().email().nullable().optional(),
    })
    .optional(),
});

export const createConditionSchema = conditionInput;

export const updateConditionSchema = z.object({
  description: z.string().trim().min(3).max(500).optional(),
  type: z.enum(Object.values(CONDITION_TYPE)).optional(),
  verificationMethod: z.enum(Object.values(VERIFICATION_METHOD)).optional(),
  requiredEvidence: z.array(z.string().trim().min(1).max(160)).max(6).optional(),
  weight: z.number().min(0.1).max(5).optional(),
  status: z.enum([CONDITION_STATUS.WAIVED, CONDITION_STATUS.FAILED, CONDITION_STATUS.PENDING]).optional(),
  order: z.number().int().min(0).max(50).optional(),
  notes: z.string().max(1000).optional(),
});

export const confirmConditionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).default(''),
});

/** Multipart form fields arrive as strings; empty ones mean "not provided". */
const emptyToNull = (schema) =>
  z.preprocess((value) => (value === '' || value === 'null' || value === undefined ? null : value), schema);
const formBoolean = z.preprocess(
  (value) => (typeof value === 'string' ? ['true', '1', 'yes', 'on'].includes(value.toLowerCase()) : value),
  z.boolean()
);

export const createEvidenceSchema = z.object({
  promiseId: objectId,
  conditionId: emptyToNull(objectId.nullable()).default(null),
  type: z.enum(Object.values(EVIDENCE_TYPE)),
  title: z.string().trim().max(160).default(''),
  url: emptyToNull(z.string().trim().url('That link does not look right.').max(500).nullable()).default(null),
  note: z.string().trim().max(2000).default(''),
  source: z.string().trim().max(80).default('upload'),
  autoVerify: formBoolean.default(true),
});

export const fundPromiseSchema = z.object({
  providerPayload: z.record(z.string(), z.any()).default({}),
});

/**
 * What a provider checkout hands back. These three are required together —
 * the signature is an HMAC over the other two, so a partial payload can never
 * be verified and is rejected before it reaches the payment service.
 */
export const verifyFundingSchema = z.object({
  providerPayload: z.object({
    razorpay_order_id: z.string().trim().min(1, 'The provider did not return an order id.'),
    razorpay_payment_id: z.string().trim().min(1, 'The provider did not return a payment id.'),
    razorpay_signature: z.string().trim().min(1, 'The provider did not return a signature.'),
  }),
});

export const fulfilPromiseSchema = z.object({
  /** Typed authorisation — the Proof Engine can never supply this. */
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'Fulfillment must be confirmed explicitly.' }),
  }),
  note: z.string().trim().max(500).default(''),
});

/**
 * Where a payout should land. Validated here and then handed straight to the
 * provider — nothing in this object is persisted by ProofPay, so the shape is
 * checked strictly rather than trusted downstream.
 */
export const payoutDestinationSchema = z
  .discriminatedUnion('method', [
    z.object({
      method: z.literal('upi'),
      vpa: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.\-_]{2,60}@[a-z]{2,30}$/i, 'That does not look like a UPI ID (name@bank).'),
    }),
    z.object({
      method: z.literal('bank'),
      accountHolder: z.string().trim().min(2, 'Whose account is this?').max(80),
      accountNumber: z
        .string()
        .trim()
        .regex(/^\d{6,20}$/, 'An account number is 6 to 20 digits.'),
      ifsc: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'That IFSC does not look right (e.g. HDFC0001234).'),
    }),
  ])
  .describe('Payout destination');

export const createDisputeSchema = z.object({
  promiseId: objectId,
  reason: z.string().trim().min(10, 'Explain what is being contested.').max(2000),
  conditionIds: z.array(objectId).max(20).default([]),
  statement: z.string().trim().max(2000).default(''),
});

export const disputeClaimSchema = z.object({
  statement: z.string().trim().min(5, 'Add your statement.').max(2000),
  evidenceIds: z.array(objectId).max(20).default([]),
});

export const resolveDisputeSchema = z.object({
  outcome: z.enum(['released', 'refunded', 'partially_released', 'withdrawn', 'dismissed']),
  note: z.string().trim().max(1000).default(''),
});

export const parsePromiseSchema = z.object({
  text: z.string().trim().min(10, 'Describe the promise in a sentence or two.').max(4000),
  currency: z.enum(CURRENCIES).default('INR'),
});

export const detectAmbiguitySchema = z.object({
  text: z.string().trim().min(5, 'Describe the promise first.').max(4000),
  conditions: z
    .array(z.object({ description: z.string().trim().min(1).max(500) }))
    .max(12)
    .default([]),
});

export const analyzeDisputeSchema = z.object({ disputeId: objectId });

export const analyzeEvidenceSchema = z.object({
  evidenceId: objectId,
  conditionId: objectId.optional(),
});

export const listPromisesQuery = z.object({
  status: z
    .union([z.enum(Object.values(PROMISE_STATUS)), z.literal('ALL')])
    .optional()
    .default('ALL'),
  search: z.string().trim().max(120).optional(),
  role: z.enum(['all', 'payer', 'recipient']).default('all'),
  sort: z.enum(['recent', 'amount', 'deadline', 'health']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listEvidenceQuery = z.object({
  promiseId: objectId.optional(),
  conditionId: objectId.optional(),
  type: z.enum(Object.values(EVIDENCE_TYPE)).optional(),
  status: z.string().trim().max(30).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

export const analyticsQuery = z.object({
  months: z.coerce.number().int().min(3).max(24).default(6),
});

export const idParam = z.object({ id: objectId });
