import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, label, children, footer, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-scrim/80 backdrop-blur-[3px]"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 24, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className={`panel engraved relative z-10 flex max-h-[92vh] w-full ${width} flex-col shadow-lift`}
          >
            <header className="flex items-start justify-between gap-4 border-b border-ink-300/60 px-5 py-4">
              <div className="min-w-0">
                {label ? <p className="label">{label}</p> : null}
                <h2 className="mt-1 font-display text-[19px] leading-tight text-paper-50">{title}</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="-m-1 p-1 text-paper-400 transition-colors hover:text-paper-50"
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer ? (
              <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-300/60 px-5 py-4">
                {footer}
              </footer>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
