import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Which theme the interface wears.
 *
 * Two different things are worth keeping apart, and the bug in most theme
 * switches is that they conflate them:
 *
 *   preference — what the person chose: 'light', 'dark', or 'system'.
 *   resolved   — what is actually on screen: 'light' or 'dark'.
 *
 * 'system' is a standing instruction, not a one-time reading. Someone whose
 * laptop turns dark at sunset expects ProofPay to follow without being asked
 * again, so the media query stays subscribed for as long as the preference is
 * 'system' and the resolved theme changes underneath it.
 */

const STORAGE_KEY = 'proofpay.theme';
const DEFAULT_PREFERENCE = 'system';

export const THEME_PREFERENCES = ['light', 'dark', 'system'];

const ThemeContext = createContext(null);

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/** What the person last chose, or the standing default. */
function storedPreference() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return THEME_PREFERENCES.includes(saved) ? saved : DEFAULT_PREFERENCE;
  } catch {
    // Private browsing, or storage the browser refuses. A theme is not worth
    // failing a render over — fall back to the default and carry on.
    return DEFAULT_PREFERENCE;
  }
}

const resolve = (preference) =>
  preference === 'system' ? (prefersDark() ? 'dark' : 'light') : preference;

/**
 * Stamps the resolved theme where CSS can see it. The same two lines run in the
 * inline script in index.html before first paint; keeping them identical is what
 * stops the page flashing the wrong theme on load.
 */
function applyTheme(resolved) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  // The browser paints its own chrome — address bar, form controls — from this.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#0A0908' : '#F5F1E8');
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(storedPreference);
  const [resolved, setResolved] = useState(() => resolve(storedPreference()));

  // The choice, written down and applied.
  useEffect(() => {
    const next = resolve(preference);
    setResolved(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Refused storage costs the preference on the next visit, nothing more.
    }
  }, [preference]);

  // Only while following the system: the OS flipping is the same event as the
  // person choosing, so it moves the interface without touching the preference.
  useEffect(() => {
    if (preference !== 'system') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => {
      const next = event.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const value = useMemo(
    () => ({
      /** 'light' | 'dark' | 'system' — what was chosen. */
      preference,
      /** 'light' | 'dark' — what is on screen right now. */
      resolved,
      setPreference: (next) => setPreference(THEME_PREFERENCES.includes(next) ? next : DEFAULT_PREFERENCE),
    }),
    [preference, resolved]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider.');
  return context;
}
