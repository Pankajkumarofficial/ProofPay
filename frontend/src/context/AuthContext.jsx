import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/authApi.js';
import { AUTH_EXPIRED } from '../services/http.js';

const AuthContext = createContext(null);

/**
 * The authenticated identity, always fetched from /api/auth/me. Nothing about
 * the user is stored client-side beyond this in-memory copy — the session lives
 * in an httpOnly cookie the browser cannot read.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  const loadSession = useCallback(async () => {
    try {
      const { user: current } = await authApi.me();
      setUser(current);
      setStatus('authenticated');
      return current;
    } catch {
      setUser(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  useEffect(() => {
    authApi.config().then(setConfig).catch(() => setConfig({ google: false, email: true }));
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setStatus('anonymous');
    };
    window.addEventListener(AUTH_EXPIRED, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED, onExpired);
  }, []);

  const signIn = useCallback(async (credentials) => {
    const { user: signedIn } = await authApi.login(credentials);
    setUser(signedIn);
    setStatus('authenticated');
    return signedIn;
  }, []);

  const signUp = useCallback(async (details) => {
    const { user: created } = await authApi.register(details);
    setUser(created);
    setStatus('authenticated');
    return created;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const updateUser = useCallback((next) => setUser(next), []);

  const value = useMemo(
    () => ({
      user,
      config,
      status,
      isAuthenticated: status === 'authenticated',
      isLoading: status === 'loading',
      signIn,
      signUp,
      signOut,
      loadSession,
      updateUser,
    }),
    [user, config, status, signIn, signUp, signOut, loadSession, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
