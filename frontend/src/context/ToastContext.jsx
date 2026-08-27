import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, AlertTriangle, Info, X, ShieldAlert } from 'lucide-react';

const ToastContext = createContext(null);

const TONE = {
  success: { icon: Check, accent: 'border-l-sage-400 text-sage-300' },
  error: { icon: ShieldAlert, accent: 'border-l-rust-400 text-rust-300' },
  warning: { icon: AlertTriangle, accent: 'border-l-ochre-400 text-ochre-300' },
  info: { icon: Info, accent: 'border-l-brass-300 text-brass-200' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
      const id = crypto.randomUUID();
      const entry = { id, tone: 'info', duration: 5200, ...toast };
      setToasts((current) => [...current.slice(-3), entry]);
      if (entry.duration) setTimeout(() => dismiss(id), entry.duration);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (title, body) => push({ tone: 'success', title, body }),
      error: (title, body) => push({ tone: 'error', title, body, duration: 7000 }),
      warning: (title, body) => push({ tone: 'warning', title, body }),
      info: (title, body) => push({ tone: 'info', title, body }),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const tone = TONE[toast.tone] ?? TONE.info;
            const Icon = tone.icon;
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.98 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className={`pointer-events-auto border border-ink-300 border-l-2 bg-ink-700 shadow-lift ${tone.accent}`}
              >
                <div className="flex items-start gap-3 p-3.5">
                  <Icon size={15} className="mt-0.5 shrink-0" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-paper-50">{toast.title}</p>
                    {toast.body ? (
                      <p className="mt-1 text-[12px] leading-relaxed text-paper-300">{toast.body}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    className="-m-1 p-1 text-paper-400 transition-colors hover:text-paper-50"
                    aria-label="Dismiss"
                  >
                    <X size={13} strokeWidth={1.75} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
