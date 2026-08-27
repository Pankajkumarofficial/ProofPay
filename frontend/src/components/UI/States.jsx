import { motion } from 'framer-motion';
import { Loader2, RefreshCw, Inbox } from 'lucide-react';
import { Button } from './Button.jsx';

/**
 * Loading, empty and error states.
 *
 * Loading never shows a plausible-looking number: it shows that a number is on
 * its way. A figure on screen in ProofPay is always a figure from the database.
 */
export function Loading({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 text-center ${className}`}>
      <div className="relative h-8 w-8">
        <span className="absolute inset-0 rounded-full border border-brass-300/30" />
        <span className="absolute inset-0 animate-pulse-ring rounded-full border border-brass-300/40" />
        <Loader2 size={16} strokeWidth={1.5} className="absolute inset-0 m-auto animate-spin text-brass-300" />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-wider text-paper-400">{label}</p>
    </div>
  );
}

/** A structural placeholder — deliberately shapeless, never a fake value. */
export function Skeleton({ className = '', lines = 1 }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="relative h-3 overflow-hidden bg-ink-500/70">
          <span className="absolute inset-y-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-paper-400/10 to-transparent" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'That did not go through', className = '' }) {
  const message =
    error?.message ?? 'The Proof Engine could not answer right now. Your payments remain unchanged.';
  return (
    <div className={`flex flex-col items-center justify-center gap-4 px-6 py-14 text-center ${className}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-rust-400/40 bg-rust-400/10">
        <span className="h-1.5 w-1.5 rounded-full bg-rust-300" />
      </div>
      <div className="max-w-md">
        <h3 className="font-display text-[17px] text-paper-50">{title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-paper-300">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="ghost" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, body, action, icon: Icon = Inbox, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex flex-col items-center justify-center px-6 py-16 text-center ${className}`}
    >
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-ink-300 bg-ink-600">
        <Icon size={18} strokeWidth={1.25} className="text-paper-400" />
      </div>
      <h3 className="max-w-sm text-balance font-display text-[21px] leading-tight text-paper-50">{title}</h3>
      {body ? (
        <p className="mt-3 max-w-md text-balance text-[13px] leading-relaxed text-paper-300">{body}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </motion.div>
  );
}
