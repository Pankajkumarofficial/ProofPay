import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Orbit, Rows3, PlusCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { PromiseConstellation } from '../components/PromiseSpace/PromiseConstellation.jsx';
import { Button } from '../components/UI/Button.jsx';
import { StatusPill } from '../components/UI/StatusPill.jsx';
import { Loading, ErrorState, EmptyState } from '../components/UI/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { useLiveUpdates, usePoll } from '../hooks/useLiveUpdates.js';
import { promiseApi } from '../services/promiseApi.js';
import { formatMoney, formatDate, daysUntil } from '../utils/format.js';
import { SPACE_FILTERS, statusMeta } from '../utils/status.js';

/** One headline figure, always sourced from the dashboard aggregation. */
function Headline({ label, value, sub }) {
  return (
    <div className="border-l border-ink-300 pl-4 first:border-l-0 first:pl-0">
      <p className="label">{label}</p>
      <p className="tnum mt-2 font-display text-[24px] leading-none text-paper-50 sm:text-[28px]">{value}</p>
      {sub ? <p className="mt-1.5 text-[11px] leading-snug text-paper-400">{sub}</p> : null}
    </div>
  );
}

export function PromiseSpace() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('ALL');
  const [view, setView] = useState('constellation');

  const dashboard = useApi(() => promiseApi.dashboard(), []);
  const space = useApi(() => promiseApi.space(), []);

  const refreshAll = () => {
    dashboard.refresh();
    space.refresh();
  };
  useLiveUpdates(refreshAll);
  usePoll(refreshAll, 60000);

  const nodes = space.data?.nodes ?? [];
  const totals = dashboard.data?.totals;

  const currency = dashboard.data?.primaryCurrency ?? 'INR';

  /** What the page leads with. */
  const headline = (() => {
    if (!totals) return { figure: '', detail: '' };
    const money = (value) => formatMoney(value, currency);

    if (totals.activePromises) {
      const waiting = [
        totals.readyPromises ? `${totals.readyPromises} ready to fulfil` : null,
        totals.contestedPromises ? `${totals.contestedPromises} contested` : null,
      ].filter(Boolean);
      return {
        figure: `${money(totals.conditionalValue)} held against your word`,
        detail: `Across ${totals.activePromises} open ${totals.activePromises === 1 ? 'promise' : 'promises'}${
          waiting.length ? ` — ${waiting.join(', ')}` : '. Nothing is waiting on you.'
        }`,
      };
    }

    if (totals.fulfilledPromises) {
      return {
        figure: `${money(totals.fulfilledValue)} moved`,
        detail: `${totals.fulfilledPromises} ${
          totals.fulfilledPromises === 1 ? 'promise' : 'promises'
        } kept and paid. Nothing is currently held.`,
      };
    }

    return {
      figure: 'No promises yet',
      detail: 'Write one, and the money stays conditional until the proof arrives.',
    };
  })();

  /** Filter counts come from the fetched rows, so they can never disagree. */
  const filters = useMemo(
    () =>
      SPACE_FILTERS.map((entry) => ({
        ...entry,
        count: entry.statuses ? nodes.filter((node) => entry.statuses.includes(node.status)).length : nodes.length,
      })),
    [nodes]
  );

  const visible = useMemo(() => {
    const entry = SPACE_FILTERS.find((item) => item.key === filter);
    if (!entry?.statuses) return nodes;
    return nodes.filter((node) => entry.statuses.includes(node.status));
  }, [nodes, filter]);

  if (space.loading || dashboard.loading) {
    return <Loading label="Loading Promise Space…" className="min-h-[70vh]" />;
  }
  if (space.error || dashboard.error) {
    return <ErrorState error={space.error ?? dashboard.error} onRetry={refreshAll} className="min-h-[70vh]" />;
  }

  if (!nodes.length) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
        <EmptyState
          icon={Orbit}
          title="Your Promise Space is empty"
          body="Describe something you’re willing to pay for, and the Proof Engine will turn it into a measurable promise."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/create" className="btn-primary px-5 py-3">
                <PlusCircle size={13} strokeWidth={1.75} /> Create a Promise
              </Link>
              <Link to="/judge" className="btn-ghost px-5 py-3">
                Judge Mode
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[27px] leading-tight text-paper-50 sm:text-[32px]">{headline.figure}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-paper-300">{headline.detail}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="quiet" size="sm" icon={RefreshCw} loading={space.refreshing} onClick={refreshAll}>
            Refresh
          </Button>
          <Link to="/create" className="btn-primary">
            <PlusCircle size={13} strokeWidth={1.75} /> New promise
          </Link>
        </div>
      </header>

      <div className="mt-7 grid grid-cols-2 gap-4 border-y border-ink-300/60 py-5 sm:grid-cols-4 sm:gap-6">
        <Headline
          label="Held conditionally"
          value={formatMoney(totals.heldValue, currency, { compact: true })}
          sub="Money the Proof Engine is watching"
        />
        <Headline
          label="Conditions proven"
          value={`${totals.verifiedConditions}/${totals.totalConditions}`}
          sub={`${totals.awaitingConditions} awaiting proof`}
        />
        <Headline label="Proof Confidence" value={`${totals.averageProofConfidence}%`} sub="Averaged across your promises" />
        <Headline
          label="At risk"
          value={totals.atRiskPromises}
          sub={totals.atRiskPromises ? 'Low health, or a deadline closing in' : 'Nothing needs attention'}
        />
      </div>

      {/* Filters, with counts computed from the rows themselves */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 flex flex-1 gap-1 overflow-x-auto pb-1">
          {filters.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setFilter(entry.key)}
              className={`flex shrink-0 items-center gap-2 border px-3 py-1.5 label transition-colors ${
                filter === entry.key
                  ? 'border-brass-300/60 bg-brass-300/10 text-brass-100'
                  : 'border-ink-300 text-paper-300 hover:border-paper-400/50 hover:text-paper-50'
              }`}
            >
              {entry.label}
              <span className="tnum text-paper-400">{entry.count}</span>
            </button>
          ))}
        </div>

        <div className="flex shrink-0 border border-ink-300">
          {[
            { key: 'constellation', icon: Orbit, label: 'Space' },
            { key: 'ledger', icon: Rows3, label: 'Ledger' },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setView(option.key)}
              className={`flex items-center gap-2 px-3 py-1.5 label transition-colors ${
                view === option.key ? 'bg-ink-500 text-paper-50' : 'text-paper-400 hover:text-paper-100'
              }`}
            >
              <option.icon size={12} strokeWidth={1.75} />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 border border-ink-300/60">
          <EmptyState
            title="Nothing in this state"
            body="Every promise you can see sits under a different filter right now."
            action={
              <Button variant="ghost" onClick={() => setFilter('ALL')}>
                Show all
              </Button>
            }
          />
        </div>
      ) : view === 'constellation' ? (
        <motion.div
          key={filter}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 border border-ink-300/60 bg-ink-900/40 p-2 sm:p-4"
        >
          <PromiseConstellation nodes={visible} onInspect={(node) => navigate(`/promises/${node.id}`)} />
                    <p className="px-3 pb-2 text-center text-[12px] text-paper-400">
            Each ring is a promise: its size is the amount, its arc the Proof Confidence, its colour the
            state, and the face inside it whoever is on the other side. Drag to rearrange, click to open.
          </p>
        </motion.div>
      ) : (
        <div className="mt-4 border border-ink-300/60">
          <div className="hidden grid-cols-[1fr_7rem_9rem_7rem_6rem] gap-4 border-b border-ink-300/60 bg-ink-900/50 px-4 py-2.5 label text-paper-400 lg:grid">
            <span>Promise</span>
            <span className="text-right">Amount</span>
            <span>State</span>
            <span className="text-right">Proven</span>
            <span className="text-right">Health</span>
          </div>
          {visible.map((node) => {
            const remaining = daysUntil(node.deadline);
            return (
              <Link
                key={node.id}
                to={`/promises/${node.id}`}
                className="ledger-row grid-cols-1 lg:grid-cols-[1fr_7rem_9rem_7rem_6rem]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-paper-50">{node.title}</span>
                  <span className="mt-0.5 block truncate label text-paper-400">
                    {node.publicId} · {node.relation === 'payer' ? 'to' : 'from'} {node.recipient}
                    {node.deadline
                      ? ['SETTLING', 'FULFILLED', 'CANCELLED'].includes(node.status)
                        ? ` · ${formatDate(node.deadline)}`
                        : ` · ${remaining >= 0 ? `${remaining}d left` : `${Math.abs(remaining)}d overdue`} · ${formatDate(node.deadline)}`
                      : ''}
                  </span>
                </span>
                <span className="tnum font-display text-[16px] text-paper-50 lg:text-right">
                  {formatMoney(node.amount, node.currency)}
                </span>
                <span>
                  <StatusPill status={node.status} size="sm" />
                </span>
                <span className="tnum font-mono text-[12px] text-paper-200 lg:text-right">
                  {node.verifiedConditions}/{node.conditions}
                </span>
                <span className="tnum flex items-center justify-between gap-2 font-mono text-[12px] lg:justify-end">
                  <span style={{ color: statusMeta(node.status).hex }}>{node.health}%</span>
                  <ArrowRight size={12} strokeWidth={1.75} className="text-paper-400 lg:hidden" />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {dashboard.data?.upcomingDeadlines?.length ? (
        <section className="mt-8">
          <p className="label">Closing soonest</p>
          <div className="mt-3 grid gap-px border border-ink-300/70 bg-ink-300/60 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.data.upcomingDeadlines.map((promise) => {
              const remaining = daysUntil(promise.deadline);
              return (
                <Link key={promise._id} to={`/promises/${promise._id}`} className="bg-ink-700 p-4 transition-colors hover:bg-ink-600">
                  <div className="flex items-start justify-between gap-3">
                    <span className="truncate text-[13px] text-paper-50">{promise.title}</span>
                    <StatusPill status={promise.status} size="sm" showDot={false} />
                  </div>
                  <p className="mt-2 flex items-baseline justify-between gap-3">
                    <span className="tnum font-display text-[18px] text-paper-50">
                      {formatMoney(promise.amount, promise.currency)}
                    </span>
                    <span
                      className={`tnum font-mono text-[11px] ${remaining < 0 ? 'text-rust-300' : remaining <= 3 ? 'text-ochre-300' : 'text-paper-400'}`}
                    >
                      {remaining < 0 ? `${Math.abs(remaining)}d overdue` : `${remaining}d left`}
                    </span>
                  </p>
                  <p className="mt-1.5 label text-paper-400">
                    {promise.proofConfidence}% proven · {promise.promiseHealth?.overall ?? 0}% health
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
