import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

/**
 * The sign-in surround: a ledger of what the product actually promises, beside
 * the form. Deliberately not a centred card on a gradient.
 */
export function AuthLayout({ children, aside }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-ink-300/60 bg-ink-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 grid-field opacity-40" aria-hidden />
        <div className="absolute -right-40 top-1/3 h-[30rem] w-[30rem] rounded-full bg-brass-300/[0.06] blur-3xl" aria-hidden />

        <div className="relative">
          <Link to="/" className="flex items-center gap-3">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
              <circle cx="16" cy="16" r="10" fill="none" stroke="#D9A441" strokeWidth="1.5" />
              <circle cx="16" cy="16" r="4" fill="none" stroke="#D9A441" strokeWidth="1.5" />
              <path d="M16 2v4M16 26v4M2 16h4M26 16h4" stroke="#D9A441" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="font-display text-[20px] text-paper-50">ProofPay</span>
          </Link>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative max-w-md"
        >
          <p className="eyebrow">The primitive</p>
          <h1 className="mt-4 font-display text-[38px] leading-[1.1] tracking-tight text-paper-50">
            Money moves when the promise is proven.
          </h1>
          <p className="mt-5 text-[14px] leading-relaxed text-paper-300">
            A payment knows who and how much. ProofPay also knows why the money should move, what has to be true
            first, and whether that has actually happened.
          </p>

          <ol className="mt-9 space-y-0">
            {['Intent', 'Conditions', 'Proof', 'Validation', 'Fulfillment'].map((step, index) => (
              <li key={step} className="flex items-center gap-4 border-t border-ink-300/60 py-3 last:border-b">
                <span className="tnum font-mono text-[10px] text-paper-400">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-[14px] text-paper-100">{step}</span>
              </li>
            ))}
          </ol>
        </motion.div>

        {aside ?? (
          <p className="relative font-mono text-[10px] uppercase tracking-widest text-paper-400">
            An AI trust layer for payments
          </p>
        )}
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
