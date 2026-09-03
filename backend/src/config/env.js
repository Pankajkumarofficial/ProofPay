import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5050,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/proofpay',
  allowMemoryDb: bool(process.env.ALLOW_MEMORY_DB, true),

  jwtSecret: process.env.JWT_SECRET || 'proofpay-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5050/api/auth/google/callback',
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  ai: {
    apiKey: process.env.AI_API_KEY || '',
    /** openai | anthropic | gemini | gateway, or "auto" to read it from the key's prefix. */
    provider: (process.env.AI_PROVIDER || 'auto').toLowerCase(),
    /** Optional. Left blank, each provider uses its own sensible default. */
    model: process.env.AI_MODEL || '',
    /**
     * An OpenAI-compatible gateway, when the models are not the vendor's own.
     *
     * Resellers and self-hosted proxies speak OpenAI's wire format while serving
     * somebody else's models, and they all issue keys beginning `sk-` — so the
     * key cannot say where it belongs and this has to. Set, it overrides prefix
     * detection entirely: the request goes here, and `AI_MODEL` names the model
     * because the gateway's catalogue is its own.
     */
    baseUrl: (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, ''),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  payment: {
    mode: (process.env.PAYMENT_MODE || 'demo').toLowerCase(),
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    /**
     * Set in the provider's dashboard alongside the endpoint URL, and different
     * from the API secret. Without it a webhook cannot be trusted, so ProofPay
     * refuses the request rather than acting on an unverified instruction.
     */
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  /**
   * Disbursement to the recipient. Capturing a payment only moves money as far
   * as the platform's own account; a payout is what carries it the last mile.
   * RazorpayX is a separate product, so it gets its own switch and may carry its
   * own credentials — falling back to the collection keys when they are shared.
   */
  payout: {
    enabled: bool(process.env.PAYOUTS_ENABLED, false),
    /** simulated | razorpayx */
    provider: (process.env.PAYOUT_PROVIDER || 'simulated').toLowerCase(),
    accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || '',
    keyId: process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAYX_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || '',
    mode: (process.env.PAYOUT_MODE || 'IMPS').toUpperCase(),
    /** How long the simulated rail takes to settle, so "in flight" is observable. */
    simulatedSettleMs: Number(process.env.PAYOUT_SIM_SETTLE_MS) || 8000,
    get configured() {
      if (!this.enabled) return false;
      if (this.provider === 'simulated') return true;
      return Boolean(this.accountNumber && this.keyId && this.keySecret);
    },
  },

  /**
   * Outbound email. Unset, ProofPay writes the message to the log instead of
   * sending it — the same shape as the deterministic Proof Engine and the
   * simulated payout rail, so the feature is demonstrable without credentials
   * and nothing silently does nothing.
   */
  mail: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.MAIL_FROM || 'ProofPay <no-reply@proofpay.app>',
    get enabled() {
      return Boolean(this.host && this.user && this.password);
    },
  },

  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024,
  get isProd() {
    return this.nodeEnv === 'production';
  },
};

/** Fails fast on misconfiguration that would silently break auth in production. */
export function assertProductionConfig() {
  if (!env.isProd) return;
  const problems = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be set to at least 32 characters in production.');
  }
  if (!process.env.MONGODB_URI) problems.push('MONGODB_URI must be set in production.');
  if (problems.length) {
    throw new Error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
  }
}
