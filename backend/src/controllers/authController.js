import { User, AuditLog, PromiseModel, Payment, AUDIT_ACTION, PAYMENT_STATUS } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { issueSession, clearSession } from '../middleware/auth.js';
import { recordAudit } from '../services/auditService.js';
import * as google from '../services/googleService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const STATE_COOKIE = 'proofpay_oauth_state';

export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const existing = await User.findOne({ email }).select('+passwordHash');
  if (existing) {
    // A Google-only account can adopt a password instead of being duplicated.
    if (!existing.passwordHash && existing.googleId) {
      await existing.setPassword(password);
      existing.authProvider = 'email+google';
      existing.lastLoginAt = new Date();
      await existing.save();
      issueSession(res, existing);
      await recordAudit({
        user: existing,
        action: AUDIT_ACTION.USER_REGISTERED,
        summary: 'Password added to an existing Google account',
        ip: req.ip,
      });
      return res.status(200).json({ success: true, data: { user: existing.toPublic() } });
    }
    throw ApiError.conflict('An account with that email already exists. Sign in instead.');
  }

  const user = new User({ name, email, authProvider: 'email' });
  await user.setPassword(password);
  user.lastLoginAt = new Date();
  await user.save();

  issueSession(res, user);
  await recordAudit({ user, action: AUDIT_ACTION.USER_REGISTERED, summary: 'Account created with email', ip: req.ip });

  res.status(201).json({ success: true, data: { user: user.toPublic() } });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user || !(await user.verifyPassword(password))) {
    throw ApiError.unauthorized('That email and password do not match an account.');
  }

  user.lastLoginAt = new Date();
  await user.save();
  issueSession(res, user);
  await recordAudit({ user, action: AUDIT_ACTION.USER_SIGNED_IN, summary: 'Signed in with email', ip: req.ip });

  res.json({ success: true, data: { user: user.toPublic() } });
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  res.json({ success: true, data: { user: user.toPublic() } });
});

export const logout = asyncHandler(async (req, res) => {
  clearSession(res);
  if (req.user) {
    await recordAudit({ user: req.user, action: AUDIT_ACTION.USER_SIGNED_OUT, summary: 'Signed out', ip: req.ip });
  }
  res.json({ success: true, data: { message: 'Signed out.' } });
});

/** Tells the sign-in screen which providers this server actually supports. */
export const authConfig = (_req, res) => {
  res.json({
    success: true,
    data: {
      google: google.googleEnabled(),
      email: true,
      proofEngine: env.ai.enabled ? 'claude' : 'local-engine',
      paymentMode: env.payment.mode,
    },
  });
};

export const googleStart = asyncHandler(async (req, res) => {
  const state = google.createState({ intent: req.query.intent === 'signup' ? 'signup' : 'signin' });
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  res.redirect(google.buildAuthUrl({ state }));
});

export const googleCallback = asyncHandler(async (req, res) => {
  const redirectWithError = (message) =>
    res.redirect(`${env.clientUrl}/signin?error=${encodeURIComponent(message)}`);

  try {
    if (req.query.error) return redirectWithError('Google sign-in was cancelled.');

    const { code, state } = req.query;
    const cookieState = req.cookies?.[STATE_COOKIE];
    if (!code || !state || !cookieState || state !== cookieState) {
      return redirectWithError('That Google sign-in could not be verified. Please try again.');
    }
    google.verifyState(state);
    res.clearCookie(STATE_COOKIE, { path: '/' });

    const identity = await google.fetchGoogleIdentity(code);

    let user = await User.findOne({ googleId: identity.googleId });
    let action = AUDIT_ACTION.USER_SIGNED_IN;
    let summary = 'Signed in with Google';

    if (!user) {
      // Same person, existing email account: link rather than duplicate.
      user = await User.findOne({ email: identity.email });
      if (user) {
        user.googleId = identity.googleId;
        user.avatar = user.avatar || identity.avatar;
        user.authProvider = user.passwordHash ? 'email+google' : 'google';
        action = AUDIT_ACTION.GOOGLE_IDENTITY_LINKED;
        summary = 'Google identity linked to an existing account';
      } else {
        user = new User({
          name: identity.name,
          email: identity.email,
          googleId: identity.googleId,
          avatar: identity.avatar,
          authProvider: 'google',
        });
        action = AUDIT_ACTION.USER_REGISTERED;
        summary = 'Account created with Google';
      }
    } else if (identity.avatar && user.avatar !== identity.avatar) {
      user.avatar = identity.avatar;
    }

    user.lastLoginAt = new Date();
    await user.save();
    issueSession(res, user);
    await recordAudit({ user, action, summary, ip: req.ip });

    res.redirect(`${env.clientUrl}/auth/callback`);
  } catch (error) {
    logger.error('Google callback failed', error.message);
    redirectWithError(
      error.expose ? error.message : 'Google sign-in could not be completed. Please try again.'
    );
  }
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.avatar !== undefined) user.avatar = req.body.avatar;
  await user.save();
  res.json({ success: true, data: { user: user.toPublic() } });
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (user.passwordHash) {
    const matches = await user.verifyPassword(req.body.currentPassword ?? '');
    if (!matches) throw ApiError.badRequest('Your current password is not correct.');
  }
  await user.setPassword(req.body.newPassword);
  user.authProvider = user.googleId ? 'email+google' : 'email';
  await user.save();
  res.json({ success: true, data: { message: 'Password updated.' } });
});

/** Profile page numbers, every one of them an aggregation over this user's records. */
export const profileSummary = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  const visibility = PromiseModel.visibilityFilter(req.user);

  const [counts, fulfilledValue, chronicleCount] = await Promise.all([
    PromiseModel.aggregate([
      { $match: visibility },
      {
        $group: {
          _id: null,
          totalPromises: { $sum: 1 },
          activePromises: {
            $sum: {
              $cond: [
                { $in: ['$status', ['FUNDED', 'ACTIVE', 'PARTIALLY_VERIFIED', 'READY_TO_FULFILL']] },
                1,
                0,
              ],
            },
          },
          fulfilledPromises: { $sum: { $cond: [{ $eq: ['$status', 'FULFILLED'] }, 1, 0] } },
          totalValue: { $sum: '$amount' },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.RELEASED } },
      {
        $lookup: {
          from: 'promises',
          localField: 'promise',
          foreignField: '_id',
          as: 'promiseDoc',
        },
      },
      { $unwind: '$promiseDoc' },
      { $match: { $or: [{ payer: req.user._id }, { 'recipient.user': req.user._id }] } },
      { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    AuditLog.countDocuments({ user: req.user._id }),
  ]);

  const summary = counts[0] ?? {
    totalPromises: 0,
    activePromises: 0,
    fulfilledPromises: 0,
    totalValue: 0,
  };

  res.json({
    success: true,
    data: {
      user: user.toPublic(),
      stats: {
        totalPromises: summary.totalPromises,
        activePromises: summary.activePromises,
        fulfilledPromises: summary.fulfilledPromises,
        totalValue: summary.totalValue,
        fulfilledValue: fulfilledValue.reduce((sum, row) => sum + row.total, 0),
        fulfilledByCurrency: fulfilledValue.map((row) => ({
          currency: row._id,
          total: row.total,
          count: row.count,
        })),
        chronicleEntries: chronicleCount,
      },
    },
  });
});
