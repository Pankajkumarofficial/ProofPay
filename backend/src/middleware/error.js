import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const notFound = (req, _res, next) => {
  next(ApiError.notFound(`No ProofPay endpoint matches ${req.method} ${req.originalUrl}.`));
};

/** People never see a raw stack or a 500. */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (error, req, res, _next) => {
  let status = error.status || 500;
  let message = error.message;
  let details = error.details;

  if (error instanceof mongoose.Error.ValidationError) {
    status = 400;
    details = Object.values(error.errors).map((issue) => ({
      field: issue.path,
      message: issue.message,
    }));
    message = details[0]?.message || 'Some of these details need a second look.';
  } else if (error instanceof mongoose.Error.CastError) {
    status = 400;
    message = 'That identifier does not look right.';
  } else if (error.code === 11000) {
    status = 409;
    message = Object.keys(error.keyPattern || {}).includes('email')
      ? 'An account with that email already exists.'
      : 'That record already exists.';
  }

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl}`, error.stack || error);
    message = 'Something went wrong on our side. Your promises and payments are unchanged.';
    details = undefined;
  }

  res.status(status).json({
    success: false,
    error: {
      message,
      ...(details ? { details } : {}),
      ...(env.isDeployed || status < 500 ? {} : { hint: 'Check the API logs for the full trace.' }),
    },
  });
};
