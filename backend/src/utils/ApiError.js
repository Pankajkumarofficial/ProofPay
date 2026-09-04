/** Errors thrown with ApiError carry a message that is safe (and useful) to show to a person. */
export class ApiError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.expose = true;
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = 'Please sign in to continue.') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'You do not have access to this promise.') {
    return new ApiError(403, message);
  }
  static notFound(message = 'We could not find what you were looking for.') {
    return new ApiError(404, message);
  }
  static conflict(message, details) {
    return new ApiError(409, message, details);
  }
  static tooMany(message = 'Too many attempts. Please wait a moment and try again.') {
    return new ApiError(429, message);
  }
  static unavailable(message, details) {
    return new ApiError(503, message, details);
  }
}
