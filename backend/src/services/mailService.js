import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Outbound email.
 *
 * Two rules shape everything here.
 *
 * The first is that email is never the point of the request. Nobody signs up in
 * order to receive a welcome message, so a mail server that is slow, down, or
 * not configured at all must not slow down or fail the thing they actually
 * asked for. Sending therefore happens after the response and never rejects.
 *
 * The second is that an unconfigured mailer writes the message to the log
 * rather than pretending to send it — the same shape as the deterministic Proof
 * Engine and the simulated payout rail. A developer with no SMTP credentials
 * can still see exactly what would have gone out, and nothing quietly does
 * nothing.
 */

let transport = null;

/**
 * A test run never sends mail.
 *
 * env.js reads process.env once at import, and a test file that imports any
 * application module before the harness clears its variables gets the
 * developer's own credentials — which meant real messages to every throwaway
 * address a test invented, on a real sending quota, to addresses that bounce.
 * Import order should not decide whether mail leaves the building, so this is
 * checked at call time and not derived from config at all.
 */
const sending = () => process.env.NODE_ENV !== 'test';

function mailer() {
  if (!sending() || !env.mail.enabled) return null;
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

/**
 * Sends one message, or logs it when no mail server is configured.
 *
 * Resolves either way and never throws: callers are doing something else, and
 * a failed notification is not a failed operation.
 */
export async function sendMail({ to, subject, text, html }) {
  const post = mailer();

  if (!post) {
    const why = sending() ? 'SMTP unconfigured' : 'test run';
    logger.info(`Mail (not sent — ${why}) → ${to} · ${subject}`);
    return { sent: false, reason: sending() ? 'SMTP is not configured' : 'mail is disabled in tests' };
  }

  try {
    const result = await post.sendMail({ from: env.mail.from, to, subject, text, html });
    logger.info(`Mail sent → ${to} · ${subject}`);
    return { sent: true, id: result.messageId };
  } catch (error) {
    // Worth knowing about, never worth failing the request that triggered it.
    logger.error(`Mail to ${to} failed (${subject}): ${error.message}`);
    return { sent: false, reason: error.message };
  }
}

/**
 * The message a new account receives.
 *
 * Written for someone who has just signed up and has not used ProofPay yet, so
 * it says what the product does in one line and points at the one action that
 * makes it make sense. No marketing, no exclamation marks, and nothing that
 * pretends money has moved.
 */
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

/**
 * Welcomes a newly created account.
 *
 * Deliberately not awaited by the caller: registration is complete the moment
 * the account exists, and this runs behind the response it does not belong to.
 */
export function sendWelcomeEmail(user) {
  if (!user?.email) return;
  const message = welcomeEmail({ name: user.name, email: user.email });
  void sendMail({ to: user.email, ...message });
}
