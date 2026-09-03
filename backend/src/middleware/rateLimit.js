import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const message = (text) => ({ success: false, error: { message: text } });

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  // Rate limiting a local demo makes it feel broken; keep it on, but generous.
  skip: () => env.nodeEnv === 'test',
};

export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
  message: message('You are moving faster than we can verify. Try again in a minute.'),
});

export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: env.isDeployed ? 20 : 100,
  message: message('Too many sign-in attempts. Please wait a few minutes and try again.'),
});

export const proofEngineLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 30,
  message: message('The Proof Engine is catching its breath. Try again shortly.'),
});

export const uploadLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 40,
  message: message('Too many uploads at once. Give the vault a moment.'),
});
