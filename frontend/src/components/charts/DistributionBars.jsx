import { useState } from 'react';
import { sequentialStep } from './palette.js';

/** Magnitude across named rows — one hue, light to dark, because the only thing being encoded is size. */
export function DistributionBars({ rows = [], format = (value) => value, valueLabel = 'Value', colourFor }) {
  const [hover, setHover] = useState(null);
  if (!rows.length) return null;

  const peak = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => {
        const width = Math.max(1.5, (row.value / peak) * 100);
        const colour = colourFor ? colourFor(row, index) : sequentialStep(index, rows.length);
        return (
          <div
            key={row.key ?? row.label}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            className="group"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] text-paper-200">{row.label}</span>
              <span className="tnum shrink-0 font-mono text-[11px] text-paper-300">{format(row.value)}</span>
            </div>
            <div className="mt-1.5 h-[6px] w-full bg-ink-500/60">
              <div
                className="h-full rounded-r-[3px] transition-[width] duration-500"
                style={{
                  width: `${width}%`,
                  backgroundColor: colour,
                  opacity: hover === null || hover === index ? 1 : 0.45,
                }}
              />
            </div>
            {row.caption ? (
              <p className="mt-1 label text-paper-400">{row.caption}</p>
            ) : null}
          </div>
        );
      })}
      <p className="sr-only">{valueLabel}</p>
    </div>
  );
}
