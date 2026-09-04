import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/** Google OAuth 2.0, server side only. */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const VALID_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export const googleEnabled = () => env.google.enabled;

/** Signs the CSRF state so the callback can prove it started here. */
export function createState(payload = {}) {
  return jwt.sign({ nonce: crypto.randomBytes(12).toString('hex'), ...payload }, env.jwtSecret, {
    expiresIn: '10m',
  });
}

export function verifyState(state) {
  try {
    return jwt.verify(state, env.jwtSecret);
  } catch {
    throw ApiError.badRequest('That Google sign-in link has expired. Please try again.');
  }
}

export function buildAuthUrl({ state }) {
  if (!googleEnabled()) {
    throw ApiError.unavailable(
      'Google sign-in is not configured on this server yet. Use email and password, or add Google credentials to the API .env.'
    );
  }
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: env.google.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCode(code) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: env.google.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw ApiError.badRequest(
      payload.error_description || 'Google could not confirm that sign-in. Please try again.'
    );
  }
  return payload;
}

/** Decodes the ID token and rejects anything not issued by Google for this app. */
function readIdToken(idToken) {
  const claims = jwt.decode(idToken);
  if (!claims) throw ApiError.badRequest('Google returned an identity we could not read.');
  if (!VALID_ISSUERS.includes(claims.iss)) throw ApiError.badRequest('That identity was not issued by Google.');
  if (claims.aud !== env.google.clientId) {
    throw ApiError.badRequest('That Google identity was issued for a different application.');
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw ApiError.badRequest('That Google sign-in has expired. Please try again.');
  }
  return claims;
}

/** Returns the verified Google profile for an authorization code. */
export async function fetchGoogleIdentity(code) {
  const tokens = await exchangeCode(code);
  const claims = tokens.id_token ? readIdToken(tokens.id_token) : {};

  let profile = {
    sub: claims.sub,
    email: claims.email,
    email_verified: claims.email_verified,
    name: claims.name,
    picture: claims.picture,
  };

  if ((!profile.sub || !profile.email) && tokens.access_token) {
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (response.ok) profile = { ...profile, ...(await response.json()) };
  }

  if (!profile.sub || !profile.email) {
    throw ApiError.badRequest('Google did not share an email address for that account.');
  }
  if (profile.email_verified === false) {
    throw ApiError.badRequest('That Google account has an unverified email address.');
  }

  return {
    googleId: profile.sub,
    email: String(profile.email).toLowerCase(),
    name: profile.name || String(profile.email).split('@')[0],
    avatar: profile.picture || null,
  };
}
