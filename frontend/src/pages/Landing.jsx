import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Cpu, Scale, ScrollText, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const LIFECYCLE = [
  { step: 'Intent', body: 'You say what you are willing to pay for, in your own words.' },
  { step: 'Conditions', body: 'The Proof Engine turns that into conditions someone can actually check.' },
  { step: 'Proof', body: 'Work is filed against a condition: a link, a file, a report, a confirmation.' },
  { step: 'Validation', body: 'Each piece is assessed against the condition it claims to settle.' },
  { step: 'Fulfillment', body: 'Once everything is proven, you authorise the release. Only you can.' },
];

const PRINCIPLES = [
  {
    icon: Cpu,
    title: 'It refuses to guess',
    body: '“Pay when the work is good” is not a condition. ProofPay says so, and asks what would actually settle it, before a rupee is committed.',
  },
  {
    icon: ShieldCheck,
    title: 'The engine never moves money',
    body: 'It reads, assesses and recommends. Fulfillment requires an authenticated payer and an explicit confirmation — there is no path from a model to a release.',
  },
  {
    icon: Scale,
    title: 'Disagreement is a first-class state',
    body: 'When accounts conflict, the promise becomes contested and the money stays conditional while the record is laid out for both sides.',
  },
  {
    icon: ScrollText,
    title: 'Everything is written down',
    body: 'Every condition, submission, assessment and release lands in the Chronicle, with a timestamp and an author.',
  },
];

export function Landing() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-300/60 bg-ink-800/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden className="text-brass-300">
              <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="16" cy="16" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M16 2v4M16 26v4M2 16h4M26 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="font-display text-[18px] text-paper-50">ProofPay</span>
          </Link>
          <nav className="flex items-center gap-2">
            {isAuthenticated ? (
              <Link to="/space" className="btn-primary">
                Promise Space
              </Link>
            ) : (
              <>
                <Link to="/signin" className="btn-quiet hidden sm:inline-flex">
                  Sign in
                </Link>
                <Link to="/signup" className="btn-primary">
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-300/60">
        <div className="absolute inset-0 grid-field opacity-50" aria-hidden />
        <div
          className="absolute left-1/2 top-0 h-[36rem] w-[52rem] -translate-x-1/2 rounded-full bg-brass-300/[0.05] blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="label"
          >
            An AI trust layer for payments
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.06 }}
            className="mt-5 max-w-3xl text-balance font-display text-[38px] leading-[1.06] tracking-tight text-paper-50 sm:text-[58px]"
          >
            Money moves when the promise is proven.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-6 max-w-xl text-[15px] leading-relaxed text-paper-300"
          >
            A payment understands who is paid and how much. ProofPay also understands why the money should move,
            what has to be true first, what evidence would show it, and whether that has actually happened.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.18 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Link to={isAuthenticated ? '/space' : '/signup'} className="btn-primary px-6 py-3 text-[12px]">
              {isAuthenticated ? 'Open Promise Space' : 'Create your Promise Space'}
              <ArrowRight size={13} strokeWidth={1.75} />
            </Link>
            <Link to="/signin" className="btn-ghost px-6 py-3 text-[12px]">
              Sign in
            </Link>
          </motion.div>

          {/* The sentence, and what the engine does with it */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.28 }}
            className="mt-16 grid gap-px border border-ink-300/70 bg-ink-300/60 md:grid-cols-[1.1fr_1fr]"
          >
            <div className="bg-ink-700 p-6 sm:p-8">
              <p className="label">What you type</p>
              <p className="mt-4 font-display text-[21px] leading-snug text-paper-100">
                “I’ll pay Rahul ₹10,000 when he delivers the website, all five acceptance tests pass, and I approve
                the final version.”
              </p>
            </div>
            <div className="bg-ink-700 p-6 sm:p-8">
              <p className="label">What ProofPay holds</p>
              <dl className="mt-4 space-y-0 font-mono text-[12px]">
                {[
                  ['Amount', '₹10,000, held conditionally'],
                  ['Recipient', 'Rahul'],
                  ['Conditions', '3, each independently checkable'],
                  ['Releases when', 'every condition is proven and you say so'],
                ].map(([term, value]) => (
                  <div key={term} className="flex items-baseline justify-between gap-4 border-b border-ink-300/60 py-2.5 last:border-0">
                    <dt className="uppercase tracking-wider text-paper-400">{term}</dt>
                    <dd className="text-right text-paper-100">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Lifecycle */}
      <section className="border-b border-ink-300/60">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <p className="label">The lifecycle</p>
          <h2 className="mt-3 max-w-lg text-balance font-display text-[28px] leading-tight text-paper-50 sm:text-[34px]">
            Five states between an intention and a payment.
          </h2>

          <ol className="mt-10 grid gap-px bg-ink-300/60 md:grid-cols-5">
            {LIFECYCLE.map((entry, index) => (
              <motion.li
                key={entry.step}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.4, delay: index * 0.07 }}
                className="bg-ink-800 p-5"
              >
                <span className="tnum font-mono text-[10px] text-brass-300">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="mt-3 font-display text-[18px] text-paper-50">{entry.step}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-paper-300">{entry.body}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* Principles */}
      <section className="border-b border-ink-300/60">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="grid gap-10 md:grid-cols-2">
            {PRINCIPLES.map((principle, index) => (
              <motion.div
                key={principle.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.45, delay: index * 0.06 }}
              >
                <span className="flex h-9 w-9 items-center justify-center border border-brass-300/40 bg-brass-300/[0.07] text-brass-300">
                  <principle.icon size={15} strokeWidth={1.6} />
                </span>
                <h3 className="mt-4 font-display text-[20px] text-paper-50">{principle.title}</h3>
                <p className="mt-2.5 max-w-md text-[13.5px] leading-relaxed text-paper-300">{principle.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="flex flex-col items-start justify-between gap-6 border border-ink-300/70 bg-ink-700 p-8 sm:flex-row sm:items-center sm:p-10">
          <div>
            <h2 className="max-w-md text-balance font-display text-[26px] leading-tight text-paper-50">
              Stop paying on trust alone.
            </h2>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-paper-300">
              Write down what has to be true. Let the proof decide when the money moves.
            </p>
          </div>
          <Link to={isAuthenticated ? '/space' : '/signup'} className="btn-primary shrink-0 px-6 py-3 text-[12px]">
            {isAuthenticated ? 'Open Promise Space' : 'Get started'}
            <ArrowRight size={13} strokeWidth={1.75} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-ink-300/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8">
          <span className="label">
            ProofPay · Intent → Conditions → Proof → Validation → Fulfillment
          </span>
          <span className="flex gap-4 label text-paper-400">
            <Link to="/signin" className="hover:text-paper-200">
              Sign in
            </Link>
            <Link to="/signup" className="hover:text-paper-200">
              Sign up
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
