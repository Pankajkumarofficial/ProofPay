import { motion } from 'framer-motion';
import { EngineBadge } from '../UI/EngineBadge.jsx';

/**
 * Proof Confidence, drawn as an instrument face.
 *
 * The value is whatever the API last calculated from this promise's conditions,
 * proof, validations and conflicts. This component holds no default and no
 * fallback number — with nothing to show it shows nothing.
 */
export function ConfidenceDial({ value, size = 176, engine, model, label = 'Proof Confidence', caption }) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const score = known ? Math.max(0, Math.min(100, value)) : 0;

  const stroke = 6;
  const radius = size / 2 - stroke * 2.4;
  const centre = size / 2;
  const sweep = 260; // degrees of travel on the face
  const start = 140; // clockwise from 3 o'clock

  const polar = (angleDeg, r) => {
    const radians = (angleDeg * Math.PI) / 180;
    return [centre + r * Math.cos(radians), centre + r * Math.sin(radians)];
  };

  const arcPath = (fromDeg, toDeg, r) => {
    const [x1, y1] = polar(fromDeg, r);
    const [x2, y2] = polar(toDeg, r);
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const tone = score >= 80 ? '#93B183' : score >= 50 ? '#D9A441' : score >= 25 ? '#DCA95C' : '#B4593F';

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${known ? `${score} percent` : 'not yet calculated'}`}>
        {/* Tick ring — an instrument, not a progress bar. */}
        {Array.from({ length: 27 }).map((_, index) => {
          const angle = start + (sweep / 26) * index;
          const major = index % 5 === 0;
          const [x1, y1] = polar(angle, radius + 9);
          const [x2, y2] = polar(angle, radius + (major ? 15 : 12));
          const passed = known && (index / 26) * 100 <= score;
          return (
            <line
              key={index}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={passed ? tone : '#3A322A'}
              strokeWidth={major ? 1.3 : 0.8}
              opacity={passed ? 0.85 : 0.6}
            />
          );
        })}

        <path d={arcPath(start, start + sweep, radius)} fill="none" stroke="#262019" strokeWidth={stroke} strokeLinecap="round" />

        {known ? (
          <motion.path
            d={arcPath(start, start + (sweep * score) / 100 || start + 0.01, radius)}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
          />
        ) : null}

        <circle cx={centre} cy={centre} r={radius - 16} fill="none" stroke="#2F2822" strokeWidth="1" />

        <text
          x={centre}
          y={centre - 2}
          textAnchor="middle"
          className="tnum"
          fontFamily="Fraunces, Georgia, serif"
          fontSize={size * 0.26}
          fill="#F6F1E7"
        >
          {known ? score : '—'}
          {known ? <tspan fontSize={size * 0.11} fill="#9A907F" dx="2">%</tspan> : null}
        </text>
        <text
          x={centre}
          y={centre + size * 0.14}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
          fontSize={size * 0.055}
          letterSpacing="2.4"
          fill="#6F675A"
        >
          {label.toUpperCase()}
        </text>
      </svg>

      {caption ? <p className="mt-1 max-w-[15rem] text-center text-[11px] leading-relaxed text-paper-400">{caption}</p> : null}
      {engine ? <EngineBadge engine={engine} model={model} className="mt-2" /> : null}
    </div>
  );
}
