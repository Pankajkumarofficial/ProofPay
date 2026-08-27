import { http } from './http.js';

export const authApi = {
  config: () => http.get('/auth/config'),
  register: (payload) => http.post('/auth/register', payload),
  login: (payload) => http.post('/auth/login', payload),
  logout: () => http.post('/auth/logout'),
  me: () => http.get('/auth/me'),
  profile: () => http.get('/auth/profile'),
  updateProfile: (payload) => http.patch('/auth/profile', payload),
  changePassword: (payload) => http.post('/auth/password', payload),
  /** A full-page redirect: the OAuth handshake belongs to the server. */
  googleUrl: (intent = 'signin') => `/api/auth/google?intent=${intent}`,
};
