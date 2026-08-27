import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { Loading, ErrorState, EmptyState } from '../components/UI/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { disputeApi } from '../services/disputeApi.js';
import { formatMoney, relativeTime, titleFromEnum } from '../utils/format.js';

const STATUS_TONE = {
  OPEN: 'text-rust-300 border-rust-400/40 bg-rust-400/10',
  UNDER_REVIEW: 'text-ochre-300 border-ochre-400/40 bg-ochre-400/10',
  RESOLVED: 'text-sage-300 border-sage-400/40 bg-sage-400/10',
  WITHDRAWN: 'text-paper-400 border-ink-300 bg-ink-500/40',
};

export function Contests() {
  const contests = useApi(() => disputeApi.list(), []);

  if (contests.loading) return <Loading label="Loading contests…" className="min-h-[60vh]" />;
  if (contests.error) return <ErrorState error={contests.error} onRetry={contests.reload} className="min-h-[60vh]" />;

  const disputes = contests.data?.disputes ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <header>
        <p className="eyebrow">Contests</p>
        <h1 className="mt-1.5 font-display text-[28px] leading-tight text-paper-50">
          {disputes.length ? `${disputes.length} contested ${disputes.length === 1 ? 'promise' : 'promises'}` : 'Contests'}
        </h1>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-paper-300">
          When accounts conflict, money stays conditional. The Proof Engine lays out what the record supports; a
          person decides.
        </p>
      </header>

      <div className="mt-6">
        {disputes.length ? (
          <div className="divide-y divide-ink-300/50 border border-ink-300/60">
            {disputes.map((dispute) => (
              <Link key={dispute._id} to={`/contests/${dispute._id}`} className="block p-5 transition-colors hover:bg-ink-500/30">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] text-paper-50">{dispute.promise?.title}</p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-paper-400">
                      {dispute.publicId} · raised by {dispute.raisedBy?.name} · {relativeTime(dispute.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tnum font-display text-[18px] text-paper-50">
                      {formatMoney(dispute.promise?.amount, dispute.promise?.currency)}
                    </span>
                    <span
                      className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                        STATUS_TONE[dispute.status] ?? STATUS_TONE.WITHDRAWN
                      }`}
                    >
                      {titleFromEnum(dispute.status)}
                    </span>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-paper-300">{dispute.reason}</p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Scale}
            title="Nothing is contested"
            body="Every promise you can see is either progressing or settled. A contest opens from a promise when the accounts disagree."
          />
        )}
      </div>
    </div>
  );
}
