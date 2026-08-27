import { motion } from 'framer-motion';

/**
 * Promise Health and its four contributing readings, straight from the API's
 * promiseHealth object. Nothing here is derived client-side — if the backend
 * changes how health is weighed, this display changes with it.
 */
const BANDS = [
  { floor: 75, label: 'Healthy', colour: '#93B183' },
  { floor: 50, label: 'Steady', colour: '#D9A441' },
  { floor: 25, label: 'At risk', colour: '#DCA95C' },
  { floor: 0, label: 'Critical', colour: '#B4593F' },
];

export const bandFor = (value) => BANDS.find((band) => value >= band.floor) ?? BANDS[BANDS.length - 1];

function Track({ label, value, colour, delay = 0 }) {
  const known = typeof value === 'number' && Number.isFinite(value);
  return (
    <div className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-paper-400">{label}</span>
      <div className="relative h-[3px] bg-ink-400">
        {known ? (
          <motion.span
            className="absolute inset-y-0 left-0"
            style={{ backgroundColor: colour }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            transition={{ duration: 0.7, delay, ease: [0.2, 0.8, 0.2, 1] }}
          />
        ) : null}
        {/* Quartile marks give the bar a scale to be read against. */}
        {[25, 50, 75].map((mark) => (
          <span key={mark} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-ink-800" style={{ left: `${mark}%` }} />
        ))}
      </div>
      <span className="tnum text-right font-mono text-[11px] text-paper-200">{known ? `${value}%` : '—'}</span>
    </div>
  );
}

export function HealthMeter({ health, compact = false }) {
  if (!health) return null;
  const band = bandFor(health.overall ?? 0);

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Promise Health</p>
          <p className="tnum mt-1.5 font-display text-[32px] leading-none" style={{ color: band.colour }}>
            {health.overall ?? '—'}
            <span className="ml-0.5 text-[15px] text-paper-400">%</span>
          </p>
        </div>
        <span
          className="mb-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider"
          style={{ color: band.colour, borderColor: `${band.colour}55`, backgroundColor: `${band.colour}12` }}
        >
          {band.label}
        </span>
      </div>

      {!compact ? (
        <div className="space-y-3">
          <Track label="Conditions" value={health.conditions} colour="#D9A441" delay={0.05} />
          <Track label="Evidence" value={health.evidence} colour="#93B183" delay={0.1} />
          <Track label="Verification" value={health.verification} colour="#E3BE7F" delay={0.15} />
          <Track label="Timeline" value={health.timeline} colour="#8B9296" delay={0.2} />
        </div>
      ) : null}
    </div>
  );
}
