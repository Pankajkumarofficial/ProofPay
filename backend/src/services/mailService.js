import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** Outbound email. */

let transport = null;

/** A test run never sends mail. */
const sending = () => process.env.NODE_ENV !== 'test';

function mailer() {
  if (!sending() || !env.mail.smtpEnabled) return null;
  transport ??= nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    // 465 is implicit TLS; everything else negotiates STARTTLS.
    secure: env.mail.port === 465,
    auth: { user: env.mail.user, pass: env.mail.password },
  });
  return transport;
}

/** Whether a real message would leave the building. */
export const mailEnabled = () => sending() && env.mail.enabled;

/** Which route messages take, for /api/health. */
export const mailTransport = () => (sending() ? env.mail.transport : 'none');

/** Splits `ProofPay <no-reply@example.com>` into the parts an API expects. */
function parseFrom(value) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return match ? { name: match[1] || undefined, email: match[2] } : { email: value.trim() };
}

/**
 * Brevo's HTTP API, over 443.
 *
 * A free Render instance cannot open 25, 465 or 587, so SMTP there does not
 * fail loudly — it hangs until it times out, and a welcome email that was
 * genuinely attempted simply never arrives.
 */
async function sendViaBrevo({ to, subject, text, html }) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.mail.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseFrom(env.mail.from),
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Brevo returned ${response.status}`);
  return payload.messageId ?? 'accepted';
}

/** Sends one message, or logs it when no route out is configured. */
export async function sendMail({ to, subject, text, html }) {
  if (!sending() || !env.mail.enabled) {
    const why = sending() ? 'no mail transport configured' : 'test run';
    logger.info(`Mail (not sent — ${why}) → ${to} · ${subject}`);
    return { sent: false, reason: why };
  }

  try {
    let id;
    if (env.mail.apiKey) {
      id = await sendViaBrevo({ to, subject, text, html });
    } else {
      const result = await mailer().sendMail({ from: env.mail.from, to, subject, text, html });
      id = result.messageId;
    }
    logger.info(`Mail sent via ${env.mail.transport} → ${to} · ${subject}`);
    return { sent: true, id };
  } catch (error) {
    // Worth knowing about, never worth failing the request that triggered it.
    logger.error(`Mail to ${to} failed (${subject}): ${error.message}`);
    return { sent: false, reason: error.message };
  }
}

/** The message a new account receives. */
export function welcomeEmail({ name, email }) {
  const firstName = (name ?? '').trim().split(/\s+/)[0] || 'there';
  const appUrl = env.clientUrl;

  const subject = 'Your ProofPay account is ready';

  const text = [
    `Hello ${firstName},`,
    '',
    'Your ProofPay account is ready.',
    '',
    'ProofPay holds money against a promise and releases it only once the',
    'promised conditions are proven — so both sides can point at a record',
    'rather than argue from memory.',
    '',
    'Write your first promise in plain English and the Proof Engine will turn',
    'it into conditions you can actually check:',
    '',
    `  ${appUrl}/create`,
    '',
    `This account is registered to ${email}. If you did not create it, reply to`,
    'this message and we will remove it.',
    '',
    '— ProofPay',
    'Money moves when the promise is proven.',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#edeeeb;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14110e;">
    <table role="presentation" style="max-width:520px;margin:0 auto;border-collapse:collapse;background:#fcfdfb;border:1px solid #c9ccc5;">
      <tr>
        <td style="padding:28px 28px 8px;">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;color:#736a5c;">PROOFPAY</p>
          <h1 style="margin:0;font-size:22px;font-weight:600;line-height:1.25;">Your account is ready</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 0;font-size:14px;line-height:1.6;color:#453d33;">
          <p style="margin:12px 0;">Hello ${escapeHtml(firstName)},</p>
          <p style="margin:12px 0;">
            ProofPay holds money against a promise and releases it only once the promised
            conditions are proven — so both sides can point at a record rather than argue
            from memory.
          </p>
          <p style="margin:12px 0;">
            Write your first promise in plain English, and the Proof Engine will turn it
            into conditions you can actually check.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 28px 24px;">
          <a href="${appUrl}/create"
             style="display:inline-block;padding:11px 18px;background:#9c6b14;color:#fdf9f0;
                    text-decoration:none;font-size:14px;font-weight:500;">Write your first promise</a>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 26px;border-top:1px solid #dfe0dd;">
          <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#736a5c;">
            This account is registered to ${escapeHtml(email)}. If you did not create it,
            reply to this message and we will remove it.
          </p>
          <p style="margin:10px 0 0;font-size:12px;color:#736a5c;">
            Money moves when the promise is proven.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

/** A name and an address both arrive from a person, so neither is trusted as markup. */
function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );
}

/** Welcomes a newly created account. */
export function sendWelcomeEmail(user) {
  if (!user?.email) return;
  const message = welcomeEmail({ name: user.name, email: user.email });
  void sendMail({ to: user.email, ...message });
}
