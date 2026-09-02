import { useState } from 'react';
import { statusMeta } from '../../utils/status.js';
import { formatMoney } from '../../utils/format.js';
import { INK, SURFACE } from './palette.js';

/**
 * How the user's promises are distributed across states.
 *
 * Colour here is the product's reserved status palette, and every segment also
 * carries its written label in the legend — state is never conveyed by colour
 * alone. A 2px surface-coloured gap separates neighbouring segments.
 */
const SIZE = 220;
const RADIUS = 86;
const THICKNESS = 20;

export function StatusDonut({ mix = [], currency = 'INR' }) {
  const [hover, setHover] = useState(null);
  const total = mix.reduce((sum, row) => sum + row.count, 0);
  if (!total) return null;

  const centre = SIZE / 2;
  const circumference = 2 * Math.PI * RADIUS;
  let offset = 0;

  const segments = mix.map((row) => {
    const fraction = row.count / total;
    const length = circumference * fraction;
    const segment = { ...row, length, offset, meta: statusMeta(row.status) };
    offset += length;
    return segment;
  });

  const active = hover !== null ? segments[hover] : null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0" role="img" aria-label="Promises by state">
        <circle cx={centre} cy={centre} r={RADIUS} fill="none" stroke={SURFACE.well} strokeWidth={THICKNESS} />
        {segments.map((segment, index) => (
          <circle
            key={segment.status}
            cx={centre}
            cy={centre}
            r={RADIUS}
            fill="none"
            stroke={segment.meta.hex}
            strokeWidth={hover === index ? THICKNESS + 4 : THICKNESS}
            // The 2px gap is drawn in the surface colour by shortening the dash.
            strokeDasharray={`${Math.max(0, segment.length - 2)} ${circumference}`}
            strokeDashoffset={-segment.offset}
            transform={`rotate(-90 ${centre} ${centre})`}
            opacity={hover === null || hover === index ? 1 : 0.4}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            className="cursor-default transition-all duration-200"
          />
        ))}
        <text
          x={centre}
          y={centre - 2}
          textAnchor="middle"
          className="tnum"
          fontFamily="Fraunces, Georgia, serif"
          fontSize="34"
          fill={INK.primary}
        >
          {active ? active.count : total}
        </text>
        <text
          x={centre}
          y={centre + 20}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
          fontSize="9"
          letterSpacing="2"
          fill={INK.dim}
        >
          {(active ? active.meta.label : 'PROMISES').toUpperCase()}
        </text>
      </svg>

      <ul className="w-full space-y-1.5">
        {segments.map((segment, index) => (
          <li
            key={segment.status}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            className="flex items-center justify-between gap-3 border-b border-ink-300/40 pb-1.5 last:border-0"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.meta.hex }} />
              <span className="truncate text-[12px] text-paper-200">{segment.meta.label}</span>
            </span>
            <span className="tnum shrink-0 font-mono text-[11px] text-paper-400">
              {segment.count} · {formatMoney(segment.value, currency, { compact: true })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
