import { useState } from 'react';
import { BarChart3, Table2, LineChart } from 'lucide-react';
import { TimelineChart, DistributionBars, StatusDonut } from '../components/charts/index.js';
import { Panel, Stat } from '../components/UI/Panel.jsx';
import { Loading, ErrorState, EmptyState } from '../components/UI/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { analyticsApi } from '../services/analyticsApi.js';
import { promiseApi } from '../services/promiseApi.js';
import { formatMoney, titleFromEnum } from '../utils/format.js';
import { conditionMeta } from '../utils/status.js';
import { STATUS } from '../components/charts/palette.js';

const RANGES = [3, 6, 12];

export function Analytics() {
  const [months, setMonths] = useState(6);
  const [asTable, setAsTable] = useState(false);

  const analytics = useApi(() => analyticsApi.get(months), [months]);
  const dashboard = useApi(() => promiseApi.dashboard(), []);

  if (analytics.loading || dashboard.loading) return <Loading label="Calculating…" className="min-h-[60vh]" />;
  if (analytics.error || dashboard.error) {
    return <ErrorState error={analytics.error ?? dashboard.error} onRetry={analytics.reload} className="min-h-[60vh]" />;
  }

  const data = analytics.data;
  const totals = dashboard.data.totals;
  const currency = dashboard.data.primaryCurrency;

  if (!totals.totalPromises) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16">
        <EmptyState
          icon={BarChart3}
          title="Nothing to chart yet"
          body="Analytics are built from your promises. Create one and these figures start moving."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Analytics</p>
          <h1 className="mt-1.5 font-display text-[28px] leading-tight text-paper-50">How your promises behave</h1>
          <p className="mt-1.5 text-[13px] text-paper-300">
            Every figure is aggregated from your own records at the moment you loaded this page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-ink-300">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setMonths(range)}
                className={`px-3 py-1.5 label transition-colors ${
                  months === range ? 'bg-ink-500 text-paper-50' : 'text-paper-400 hover:text-paper-100'
                }`}
              >
                {range}M
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAsTable((current) => !current)}
            className="flex items-center gap-2 border border-ink-300 px-3 py-1.5 label text-paper-300 transition-colors hover:text-paper-50"
          >
            {asTable ? <LineChart size={12} strokeWidth={1.75} /> : <Table2 size={12} strokeWidth={1.75} />}
            {asTable ? 'Chart' : 'Table'}
          </button>
        </div>
      </header>

      <div className="mt-7 grid grid-cols-2 gap-5 border-y border-ink-300/60 py-5 sm:grid-cols-4">
        <Stat label="Total promised" value={formatMoney(totals.totalValue, currency, { compact: true })} sub={`${totals.totalPromises} promises`} />
        <Stat
          label="Fulfilled"
          value={formatMoney(totals.fulfilledValue, currency, { compact: true })}
          sub={`${totals.fulfilledPromises} settled`}
          tone="sage"
        />
        <Stat
          label="Average settlement"
          value={data.settlement.count ? `${data.settlement.averageDays}d` : '—'}
          sub={data.settlement.count ? `Fastest ${data.settlement.fastestDays}d` : 'Nothing fulfilled yet'}
        />
        <Stat
          label="Average health"
          value={`${totals.averagePromiseHealth}%`}
          sub={`${totals.atRiskPromises} at risk`}
          tone={totals.averagePromiseHealth >= 60 ? 'sage' : 'ochre'}
        />
      </div>

      <div className="mt-6 space-y-6">
        <Panel label="Value over time" title="Promised against fulfilled">
          {asTable ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left">
                <thead>
                  <tr className="border-b border-ink-300/60 label text-paper-400">
                    <th className="py-2 pr-4 font-normal">Month</th>
                    <th className="py-2 pr-4 text-right font-normal">Promised</th>
                    <th className="py-2 pr-4 text-right font-normal">Value</th>
                    <th className="py-2 pr-4 text-right font-normal">Fulfilled</th>
                    <th className="py-2 text-right font-normal">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.timeline.map((row) => (
                    <tr key={row.label} className="border-b border-ink-300/40 text-[13px] text-paper-200">
                      <td className="py-2 pr-4">{row.label}</td>
                      <td className="tnum py-2 pr-4 text-right">{row.created}</td>
                      <td className="tnum py-2 pr-4 text-right">{formatMoney(row.createdValue, currency)}</td>
                      <td className="tnum py-2 pr-4 text-right">{row.fulfilled}</td>
                      <td className="tnum py-2 text-right">{formatMoney(row.fulfilledValue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <TimelineChart timeline={data.timeline} currency={currency} />
          )}
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel label="Distribution" title="Promises by state">
            <StatusDonut mix={data.statusMix} currency={currency} />
          </Panel>

          <Panel label="Conditions" title="Where conditions stand">
            <DistributionBars
              rows={data.conditionMix.map((row) => ({
                key: row.status,
                label: conditionMeta(row.status).label,
                value: row.count,
                caption: `${Math.round((row.count / Math.max(1, totals.totalConditions)) * 100)}% of all conditions`,
              }))}
              colourFor={(row) => conditionMeta(row.key).hex}
              format={(value) => `${value}`}
            />
          </Panel>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel label="Proof" title="What proof looks like">
            {data.evidenceMix.length ? (
              <DistributionBars
                rows={data.evidenceMix.map((row) => ({
                  key: row.type,
                  label: titleFromEnum(row.type),
                  value: row.count,
                  caption: `Average confidence ${row.averageConfidence}%`,
                }))}
                format={(value) => `${value}`}
              />
            ) : (
              <p className="py-6 text-center text-[13px] text-paper-400">No proof has been filed yet.</p>
            )}
          </Panel>

          <Panel label="Counterparties" title="Who you promise to">
            <DistributionBars
              rows={data.counterparties.map((row) => ({
                key: row.name,
                label: row.name,
                value: row.value,
                caption: `${row.count} promise${row.count === 1 ? '' : 's'} · ${row.fulfilled} fulfilled · ${row.averageConfidence}% average confidence`,
              }))}
              format={(value) => formatMoney(value, currency, { compact: true })}
            />
          </Panel>
        </div>

        <Panel label="Risk" title="Open promises by health band">
          <DistributionBars
            rows={data.healthBands.map((row) => ({
              key: row.band,
              label: row.band,
              value: row.count,
              caption: `${formatMoney(row.value, currency, { compact: true })} exposed`,
            }))}
            colourFor={(row) =>
              ({ Healthy: STATUS.good, Steady: STATUS.accent, 'At risk': STATUS.warn, Critical: STATUS.bad })[row.key] ?? STATUS.neutral
            }
            format={(value) => `${value}`}
          />
        </Panel>
      </div>
    </div>
  );
}
