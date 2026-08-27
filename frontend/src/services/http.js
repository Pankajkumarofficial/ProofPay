import axios from 'axios';

/**
 * One HTTP client for the whole app.
 *
 * The session is an httpOnly cookie, so there is no token in JavaScript to leak;
 * `withCredentials` is what carries it. Errors are normalised here so every
 * screen can show the message the API wrote for a person, never a status code.
 */
export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 45000,
  headers: { 'Content-Type': 'application/json' },
});

export class ApiError extends Error {
  constructor(message, { status, details, isNetwork = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.isNetwork = isNetwork;
  }

  /** Field-level messages, keyed for react-hook-form. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.map((issue) => [issue.field, issue.message]));
  }
}

const NETWORK_MESSAGE =
  'We could not reach ProofPay. Check that the API is running, then try again — nothing has changed.';

http.interceptors.response.use(
  (response) => response.data?.data ?? response.data,
  (error) => {
    if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') {
      return Promise.reject(new ApiError(NETWORK_MESSAGE, { isNetwork: true }));
    }
    const status = error.response?.status;
    const payload = error.response?.data?.error;
    return Promise.reject(
      new ApiError(payload?.message || 'Something went wrong. Your promises and payments are unchanged.', {
        status,
        details: payload?.details,
      })
    );
  }
);

/** A 401 anywhere means the session is gone; the auth context listens for this. */
export const AUTH_EXPIRED = 'proofpay:auth-expired';

http.interceptors.response.use(undefined, (error) => {
  if (error.status === 401 && !window.location.pathname.startsWith('/sign')) {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED));
  }
  return Promise.reject(error);
});
