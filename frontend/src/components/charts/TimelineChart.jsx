import { useMemo, useState } from 'react';
import { AXIS_TEXT, GRID, INK, LABEL_TEXT, SERIES_ORDER, SURFACE } from './palette.js';
import { formatMoney } from '../../utils/format.js';

/**
 * Promised value against fulfilled value, month by month.
 *
 * Both series are money in the same currency, so they share one axis — there is
 * no second scale anywhere in this product. The points come from the analytics
 * aggregation; an empty month is a real zero, not a gap.
 */
const W = 720;
const H = 260;
const PAD = { top: 18, right: 18, bottom: 30, left: 54 };

export function TimelineChart({ timeline = [], currency = 'INR' }) {
  const [hover, setHover] = useState(null);

  const geometry = useMemo(() => {
    if (!timeline.length) return null;
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const peak = Math.max(...timeline.flatMap((row) => [row.createdValue, row.fulfilledValue]), 1);
    // Round the ceiling up to something a person would choose.
    const magnitude = 10 ** Math.floor(Math.log10(peak));
    const ceiling = Math.ceil(peak / magnitude) * magnitude;

    const x = (index) =>
      PAD.left + (timeline.length === 1 ? plotW / 2 : (plotW / (timeline.length - 1)) * index);
    const y = (value) => PAD.top + plotH - (value / ceiling) * plotH;

    const line = (key) =>
      timeline.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(row[key])}`).join(' ');
    const area = (key) =>
      `${line(key)} L ${x(timeline.length - 1)} ${PAD.top + plotH} L ${x(0)} ${PAD.top + plotH} Z`;

    return { x, y, line, area, ceiling, plotH, plotW };
  }, [timeline]);

  if (!geometry) return null;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => geometry.ceiling * fraction);
  const keyFor = { created: 'createdValue', fulfilled: 'fulfilledValue' };
  const point = hover === null ? null : timeline[hover];

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {SERIES_ORDER.map((series) => (
          <span key={series.key} className="flex items-center gap-2">
            <span className="h-[2px] w-4" style={{ backgroundColor: series.colour }} />
            <span className="label text-paper-300">{series.label}</span>
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label="Promised and fulfilled value by month"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {SERIES_ORDER.map((series) => (
            <linearGradient key={series.key} id={`fill-${series.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.colour} stopOpacity="0.20" />
              <stop offset="100%" stopColor={series.colour} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((tick, index) => (
          <g key={index}>
            <line x1={PAD.left} x2={W - PAD.right} y1={geometry.y(tick)} y2={geometry.y(tick)} stroke={GRID} strokeWidth="1" />
            <text
              x={PAD.left - 8}
              y={geometry.y(tick) + 3}
              textAnchor="end"
              fontFamily="JetBrains Mono, monospace"
              fontSize="9"
              fill={AXIS_TEXT}
            >
              {tick === 0 ? '0' : formatMoney(tick, currency, { compact: true })}
            </text>
          </g>
        ))}

        {SERIES_ORDER.map((series) => (
          <g key={series.key}>
            <path d={geometry.area(keyFor[series.key])} fill={`url(#fill-${series.key})`} />
            <path
              d={geometry.line(keyFor[series.key])}
              fill="none"
              stroke={series.colour}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}

        {/* Crosshair and markers for the month under the cursor */}
        {point ? (
          <g>
            <line
              x1={geometry.x(hover)}
              x2={geometry.x(hover)}
              y1={PAD.top}
              y2={PAD.top + geometry.plotH}
              stroke={LABEL_TEXT}
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            {SERIES_ORDER.map((series) => (
              <circle
                key={series.key}
                cx={geometry.x(hover)}
                cy={geometry.y(point[keyFor[series.key]])}
                r="4.5"
                fill={series.colour}
                stroke={SURFACE.page}
                strokeWidth="2"
              />
            ))}
          </g>
        ) : null}

        {timeline.map((row, index) => (
          <g key={row.label}>
            <rect
              x={geometry.x(index) - geometry.plotW / (timeline.length * 2)}
              y={PAD.top}
              width={geometry.plotW / timeline.length}
              height={geometry.plotH}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
            <text
              x={geometry.x(index)}
              y={H - 10}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize="9"
              fill={hover === index ? INK.primary : AXIS_TEXT}
            >
              {row.label}
            </text>
          </g>
        ))}
      </svg>

      {/* Readout, in text tokens — the colour lives on the swatch, not the words */}
      <div className="mt-2 flex min-h-[2.75rem] flex-wrap items-center gap-x-6 gap-y-1 border-t border-ink-300/60 pt-2">
        {point ? (
          <>
            <span className="label">{point.label}</span>
            {SERIES_ORDER.map((series) => (
              <span key={series.key} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: series.colour }} />
                <span className="tnum text-[12px] text-paper-100">
                  {formatMoney(point[keyFor[series.key]], currency)}
                </span>
                <span className="text-[11px] text-paper-400">
                  {point[series.key]} promise{point[series.key] === 1 ? '' : 's'}
                </span>
              </span>
            ))}
          </>
        ) : (
          <span className="text-[11px] text-paper-400">Hover a month to read its figures.</span>
        )}
      </div>
    </figure>
  );
}
