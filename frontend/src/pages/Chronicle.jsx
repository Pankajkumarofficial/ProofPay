import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { ChronicleFeed } from '../components/Chronicle/ChronicleFeed.jsx';
import { Loading, ErrorState, EmptyState } from '../components/UI/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { useLiveUpdates } from '../hooks/useLiveUpdates.js';
import { analyticsApi } from '../services/analyticsApi.js';
import { titleFromEnum } from '../utils/format.js';

export function Chronicle() {
  const [action, setAction] = useState('');
  const chronicle = useApi(() => analyticsApi.chronicle({ limit: 120, ...(action ? { action } : {}) }), [action]);
  useLiveUpdates(() => chronicle.refresh());

  const entries = chronicle.data?.entries ?? [];
  const counts = chronicle.data?.actionCounts ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <header>
        <p className="label">Chronicle</p>
        <h1 className="mt-1.5 font-display text-[28px] leading-tight text-paper-50">Everything that has happened</h1>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-paper-300">
          Append-only. Every promise, condition, submission, assessment and release writes a line here, with a
          timestamp and an author.
        </p>
      </header>

      {counts.length ? (
        <div className="-mx-1 mt-6 flex gap-1 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setAction('')}
            className={`flex shrink-0 items-center gap-2 border px-3 py-1.5 label transition-colors ${
              action === '' ? 'border-brass-300/60 bg-brass-300/10 text-brass-100' : 'border-ink-300 text-paper-300 hover:text-paper-50'
            }`}
          >
            All
            <span className="tnum text-paper-400">{counts.reduce((sum, row) => sum + row.count, 0)}</span>
          </button>
          {counts.slice(0, 10).map((row) => (
            <button
              key={row.action}
              type="button"
              onClick={() => setAction(row.action)}
              className={`flex shrink-0 items-center gap-2 border px-3 py-1.5 label transition-colors ${
                action === row.action
                  ? 'border-brass-300/60 bg-brass-300/10 text-brass-100'
                  : 'border-ink-300 text-paper-300 hover:text-paper-50'
              }`}
            >
              {titleFromEnum(row.action)}
              <span className="tnum text-paper-400">{row.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-6 border border-ink-300/60 px-4 py-5 sm:px-6">
        {chronicle.loading ? (
          <Loading label="Loading Chronicle…" />
        ) : chronicle.error ? (
          <ErrorState error={chronicle.error} onRetry={chronicle.reload} />
        ) : entries.length ? (
          <ChronicleFeed entries={entries} showPromise />
        ) : (
          <EmptyState
            icon={ScrollText}
            title="The Chronicle is empty"
            body="It fills itself as you use ProofPay — nothing here is written by hand."
          />
        )}
      </div>
    </div>
  );
}
