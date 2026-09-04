import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

/** The origin this deployment answers on, when the platform knows it and we do not. */
const externalUrl = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');

/** An address that only resolves on the machine that serves it. */
const pointsAtLocalhost = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

/** Things that were configured wrongly and overruled, reported once at boot. */
export const configNotices = [];

/** Prefers an explicit setting, except when it cannot possibly be right. */
const publicUrl = (name, explicit, derived) => {
  if (explicit && externalUrl && pointsAtLocalhost(explicit)) {
    configNotices.push(
      `${name} is set to ${explicit}, which no visitor can reach. Using ${derived} instead — ` +
        `remove ${name} from this service's environment.`
    );
    return derived;
  }
  return explicit || derived;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5050,
  /** Where the interface lives, for CORS and for OAuth redirects. */
  clientUrl: publicUrl('CLIENT_URL', process.env.CLIENT_URL, externalUrl || 'http://localhost:5173'),

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/proofpay',
  allowMemoryDb: bool(process.env.ALLOW_MEMORY_DB, true),

  jwtSecret: process.env.JWT_SECRET || 'proofpay-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    /** Sent to Google as `redirect_uri`, so a deployment keeping the localhost default does not fail. */
    callbackUrl: publicUrl(
      'GOOGLE_CALLBACK_URL',
      process.env.GOOGLE_CALLBACK_URL,
      externalUrl
        ? `${externalUrl}/api/auth/google/callback`
        : 'http://localhost:5050/api/auth/google/callback'
    ),
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
    /** An OpenAI-compatible gateway, when the models are not the vendor's own. */
    baseUrl: (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, ''),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  payment: {
    mode: (process.env.PAYMENT_MODE || 'demo').toLowerCase(),
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    /** Set in the provider's dashboard alongside the endpoint URL, and different from the API secret. */
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  /** Disbursement to the recipient. */
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

  /** Outbound email. */
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

  /** What a developer declared. */
  get isProd() {
    return this.nodeEnv === 'production';
  },

  /** Whether this process is answering the public internet. */
  get isDeployed() {
    return Boolean(externalUrl) || this.isProd;
  },
};

/** The path Google must be sent back to. */
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
export const googleCallbackIsRoutable = () => env.google.callbackUrl.endsWith(GOOGLE_CALLBACK_PATH);

/** Fails fast on misconfiguration that would silently break auth on a live host. */
export function assertProductionConfig() {
  if (!env.isDeployed) return;
  const problems = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be set to at least 32 characters in production.');
  }
  if (!process.env.MONGODB_URI) problems.push('MONGODB_URI must be set in production.');

  // A host with no external URL to fall back on cannot correct these itself, so they stay fatal.
  if (pointsAtLocalhost(env.clientUrl)) {
    problems.push(
      `CLIENT_URL is ${env.clientUrl}, which no visitor's browser can reach. ` +
        'Set it to this service\'s public URL.'
    );
  }
  if (env.google.enabled && pointsAtLocalhost(env.google.callbackUrl)) {
    problems.push(
      `GOOGLE_CALLBACK_URL is ${env.google.callbackUrl}, which sends the visitor to their ` +
        'own machine rather than back here. Set it to ' +
        'https://<this-host>/api/auth/google/callback, or unset GOOGLE_CLIENT_ID and ' +
        'GOOGLE_CLIENT_SECRET to run without Google sign-in.'
    );
  }

  if (env.google.enabled && !googleCallbackIsRoutable()) {
    problems.push(
      `GOOGLE_CALLBACK_URL is ${env.google.callbackUrl}, which does not end in ` +
        `${GOOGLE_CALLBACK_PATH} — no route serves the handshake there.`
    );
  }

  if (problems.length) {
    throw new Error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
  }
}
