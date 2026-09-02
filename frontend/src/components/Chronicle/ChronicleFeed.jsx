import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FilePlus2, Banknote, ShieldCheck, FileCheck2, Upload, Scale, CircleDot,
  UserPlus, LogIn, LogOut, Link2, Pencil, XCircle, Send, Gavel, Cpu,
} from 'lucide-react';
import { formatDate, formatTime, relativeTime } from '../../utils/format.js';

/**
 * The Chronicle: an append-only reading of AuditLog rows. Times, actors and
 * summaries are all stored values — this component only decides the icon.
 */
const ICONS = {
  USER_REGISTERED: UserPlus,
  USER_SIGNED_IN: LogIn,
  USER_SIGNED_OUT: LogOut,
  GOOGLE_IDENTITY_LINKED: Link2,
  PROMISE_CREATED: FilePlus2,
  PROMISE_MODIFIED: Pencil,
  PROMISE_FUNDED: Banknote,
  PROMISE_CANCELLED: XCircle,
  PROMISE_CONTESTED: Scale,
  PROMISE_FULFILLED: ShieldCheck,
  PROMISE_STATUS_CHANGED: CircleDot,
  CONDITION_CREATED: FilePlus2,
  CONDITION_MODIFIED: Pencil,
  CONDITION_VERIFIED: FileCheck2,
  CONDITION_FAILED: XCircle,
  CONDITION_REMOVED: XCircle,
  EVIDENCE_SUBMITTED: Upload,
  EVIDENCE_VERIFIED: Cpu,
  PROOF_ENGINE_ANALYSIS: Cpu,
  PAYMENT_RELEASED: Send,
  PAYMENT_REFUNDED: Banknote,
  DISPUTE_OPENED: Scale,
  DISPUTE_EVIDENCE_ADDED: Upload,
  DISPUTE_ANALYSED: Cpu,
  DISPUTE_RESOLVED: Gavel,
};

const TONE = {
  PROMISE_FULFILLED: 'text-sage-300 border-sage-400/40',
  CONDITION_VERIFIED: 'text-sage-300 border-sage-400/40',
  PAYMENT_RELEASED: 'text-sage-300 border-sage-400/40',
  PROMISE_CONTESTED: 'text-rust-300 border-rust-400/40',
  DISPUTE_OPENED: 'text-rust-300 border-rust-400/40',
  CONDITION_FAILED: 'text-rust-300 border-rust-400/40',
  PROMISE_CANCELLED: 'text-rust-300 border-rust-400/40',
  PROMISE_FUNDED: 'text-brass-200 border-brass-300/40',
  EVIDENCE_SUBMITTED: 'text-brass-200 border-brass-300/40',
  EVIDENCE_VERIFIED: 'text-ochre-300 border-ochre-400/40',
};

export function ChronicleFeed({ entries = [], showPromise = false, dense = false }) {
  if (!entries.length) {
    return (
      <p className="px-1 py-8 text-center text-[13px] text-paper-400">
        Nothing has happened here yet. Every action writes a line to the Chronicle.
      </p>
    );
  }

  let lastDay = null;

  return (
    <ol className="relative">
      {/* The spine the entries hang from */}
      <span className="absolute bottom-2 left-[1.05rem] top-2 w-px bg-ink-300/70" aria-hidden />
      {entries.map((entry, index) => {
        const Icon = ICONS[entry.action] ?? CircleDot;
        const tone = TONE[entry.action] ?? 'text-paper-300 border-ink-300';
        const day = formatDate(entry.createdAt);
        const newDay = day !== lastDay;
        lastDay = day;

        return (
          <motion.li
            key={entry._id ?? index}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.24, delay: Math.min(0.3, index * 0.018) }}
            className="relative"
          >
            {newDay ? (
              <p className="ml-11 pb-2 pt-4 label text-paper-400 first:pt-0">
                {day}
              </p>
            ) : null}
            <div className={`relative flex gap-3.5 ${dense ? 'py-2' : 'py-2.5'}`}>
              <span
                className={`relative z-10 mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border bg-ink-700 ${tone}`}
              >
                <Icon size={13} strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <p className="wrap-pasted text-[13px] leading-snug text-paper-100">{entry.summary || entry.action}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 label text-paper-400">
                  <span className="tnum">{formatTime(entry.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span>{entry.user?.name ?? entry.actorName ?? 'System'}</span>
                  {showPromise && entry.promise ? (
                    <>
                      <span aria-hidden>·</span>
                      <Link to={`/promises/${entry.promise._id}`} className="text-brass-200 hover:text-brass-100">
                        {entry.promise.title}
                      </Link>
                    </>
                  ) : null}
                  <span aria-hidden>·</span>
                  <span title={formatDate(entry.createdAt, { withTime: true })}>{relativeTime(entry.createdAt)}</span>
                </p>
              </div>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
