import { ApiError } from '../utils/ApiError.js';

/**
 * Validates and replaces req.body / req.query / req.params with the parsed
 * result, so controllers only ever see data that matched a schema.
 */
export const validate = (schemas) => (req, _res, next) => {
  for (const key of ['body', 'query', 'params']) {
    const schema = schemas[key];
    if (!schema) continue;
    const result = schema.safeParse(req[key]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || key,
        message: issue.message,
      }));
      return next(
        ApiError.badRequest(details[0]?.message || 'Some of these details need a second look.', details)
      );
    }
    if (key === 'query') {
      // Express 5 makes req.query a getter; assign field-by-field to stay safe.
      req.validatedQuery = result.data;
    } else {
      req[key] = result.data;
    }
  }
  next();
};
