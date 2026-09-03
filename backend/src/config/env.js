import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

/**
 * The origin this deployment answers on, when the platform knows it and we do
 * not. Render sets `RENDER_EXTERNAL_URL`; there is nothing equivalent locally,
 * which is why every fallback below still ends at localhost.
 */
const externalUrl = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');

/**
 * An address that only resolves on the machine that serves it.
 *
 * Every URL below is one a visitor's browser is told to go to, so a localhost
 * value does not fail on the server — it fails in somebody else's browser,
 * pointing at their machine rather than at this service.
 */
const pointsAtLocalhost = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

/** Things that were configured wrongly and overruled, reported once at boot. */
export const configNotices = [];

/**
 * Prefers an explicit setting, except when it cannot possibly be right.
 *
 * A service that knows its own public address has no correct reading of
 * "send the visitor to localhost" — it is always a value left behind from
 * development, in a dashboard nobody thought to revisit. Honouring it produces
 * a site that works perfectly until the moment it hands someone away, so it is
 * overruled here. Loudly: an ignored setting that says nothing is how the
 * dashboard and the running service disagree for a week.
 */
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
  /**
   * Where the interface lives, for CORS and for OAuth redirects.
   *
   * A deployment serves both halves from one origin, and that origin is not
   * known until the host has created the service — so on Render the platform's
   * own `RENDER_EXTERNAL_URL` stands in, and there is no first deploy that has
   * to fail before its URL can be written into its own configuration.
   */
  clientUrl: publicUrl('CLIENT_URL', process.env.CLIENT_URL, externalUrl || 'http://localhost:5173'),

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/proofpay',
  allowMemoryDb: bool(process.env.ALLOW_MEMORY_DB, true),

  jwtSecret: process.env.JWT_SECRET || 'proofpay-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    /**
     * Where Google sends the browser back to.
     *
     * This has to be derived the same way `clientUrl` is, and for a sharper
     * reason. It is sent to Google as `redirect_uri`, so a deployment that
     * keeps the localhost default does not fail — it hands Google an address
     * on the *visitor's own machine*. Google obligingly redirects there, and
     * anyone running the project locally is signed into their local copy by a
     * button on the live site, while everyone else gets a dead tab. The
     * deployment looked configured the whole time: the client id and secret
     * were set, so the button was offered.
     */
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

  /** What a developer declared. */
  get isProd() {
    return this.nodeEnv === 'production';
  },

  /**
   * Whether this process is answering the public internet — which is what
   * every hardening switch below actually cares about.
   *
   * `NODE_ENV` states an intention and can simply be missing: a service created
   * from the dashboard rather than from `render.yaml` never receives it, and
   * then secure cookies, CSP, the strict rate limit and the production config
   * checks are all silently off on a live site that looks entirely healthy.
   * The platform's own external URL cannot be forgotten in the same way, so a
   * host that has one is treated as deployed whatever `NODE_ENV` says.
   */
  get isDeployed() {
    return Boolean(externalUrl) || this.isProd;
  },
};

/**
 * The path Google must be sent back to. A `redirect_uri` of the bare origin is
 * a plausible-looking value that cannot work: nothing serves the handshake
 * there, so Google either refuses it as unregistered or delivers the visitor to
 * a page that knows nothing about the code in its query string.
 */
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

  // A host with no external URL to fall back on cannot correct these itself,
  // so they stay fatal. Where one exists, `publicUrl` has already overruled
  // them and left a notice instead.
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
