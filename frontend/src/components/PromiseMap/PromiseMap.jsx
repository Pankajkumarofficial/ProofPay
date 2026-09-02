import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { conditionMeta, evidenceMeta } from '../../utils/status.js';
import { formatMoney } from '../../utils/format.js';
import { INK, STATUS, SURFACE } from '../charts/palette.js';

/**
 * The Promise Map.
 *
 * Every node is generated from data: the centre is the promise's own amount, the
 * ring holds one node per condition row in MongoDB, and each condition carries
 * the proof filed against it as satellites. One condition or twelve, no proof or
 * forty pieces — the geometry is computed, never enumerated.
 */
const VIEW = 820;
const CENTRE = VIEW / 2;

const polar = (angle, radius) => [
  CENTRE + radius * Math.cos((angle * Math.PI) / 180),
  CENTRE + radius * Math.sin((angle * Math.PI) / 180),
];

export function PromiseMap({
  promise,
  conditions = [],
  evidence = [],
  verifications = [],
  selectedConditionId,
  onSelectCondition,
}) {
  const [hovered, setHovered] = useState(null);

  const layout = useMemo(() => {
    const count = conditions.length;
    if (!count) return [];

    // Rings breathe outward as conditions multiply, so labels never collide.
    const ringRadius = count <= 2 ? 190 : count <= 5 ? 230 : count <= 8 ? 258 : 278;
    // Start at the top and travel clockwise.
    const step = 360 / count;

    return conditions.map((condition, index) => {
      const angle = -90 + step * index;
      const [x, y] = polar(angle, ringRadius);
      const proof = evidence.filter((item) => String(item.condition?._id ?? item.condition) === String(condition._id));
      const validations = verifications.filter(
        (item) => String(item.condition?._id ?? item.condition) === String(condition._id)
      );

      const satelliteRadius = count <= 4 ? 62 : 52;
      const visible = proof.slice(0, 4);
      const satellites = visible.map((item, satelliteIndex) => {
        // Fan the satellites out along the condition's own outward direction.
        const spread = visible.length === 1 ? 0 : 46;
        const satelliteAngle = angle - spread / 2 + (spread / Math.max(1, visible.length - 1)) * satelliteIndex;
        const px = x + satelliteRadius * Math.cos((satelliteAngle * Math.PI) / 180);
        const py = y + satelliteRadius * Math.sin((satelliteAngle * Math.PI) / 180);
        return { item, x: px, y: py };
      });

      return {
        condition,
        angle,
        x,
        y,
        proof,
        satellites,
        overflow: Math.max(0, proof.length - visible.length),
        validations,
      };
    });
  }, [conditions, evidence, verifications]);

  const verifiedCount = conditions.filter((condition) => ['VERIFIED', 'WAIVED'].includes(condition.status)).length;
  const active = layout.find((node) => String(node.condition._id) === String(hovered ?? selectedConditionId));

  if (!conditions.length) {
    return (
      <div className="flex h-full min-h-[18rem] items-center justify-center px-6 text-center">
        <p className="max-w-xs text-[13px] leading-relaxed text-paper-400">
          This promise has no conditions yet. Add one and it appears here as a node on the map.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {/* Square viewBox, capped height: the map stays on screen beside the panels. */}
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="xMidYMid meet"
        className="mx-auto w-full"
        style={{ maxHeight: 'min(66vh, 33rem)' }}
        role="img"
        aria-label="Promise map"
      >
        <defs>
          <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={STATUS.accent} stopOpacity="0.20" />
            <stop offset="70%" stopColor={STATUS.accent} stopOpacity="0.04" />
            <stop offset="100%" stopColor={STATUS.accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Orbit guides */}
        {[120, 190, 258, 300].map((radius) => (
          <circle key={radius} cx={CENTRE} cy={CENTRE} r={radius} fill="none" stroke={SURFACE.hairlineSoft} strokeWidth="1" strokeDasharray="2 7" opacity="0.5" />
        ))}
        <circle cx={CENTRE} cy={CENTRE} r={300} fill="url(#core-glow)" />

        {/* Connectors: centre → condition, coloured by that condition's state */}
        {layout.map((node) => {
          const meta = conditionMeta(node.condition.status);
          const isActive = String(node.condition._id) === String(hovered ?? selectedConditionId);
          return (
            <motion.line
              key={`link-${node.condition._id}`}
              x1={CENTRE}
              y1={CENTRE}
              x2={node.x}
              y2={node.y}
              stroke={meta.hex}
              strokeWidth={isActive ? 1.6 : 1}
              strokeDasharray={node.condition.status === 'VERIFIED' ? '0' : '3 5'}
              opacity={isActive ? 0.9 : 0.42}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6 }}
            />
          );
        })}

        {/* Proof satellites */}
        {layout.map((node) =>
          node.satellites.map(({ item, x, y }) => {
            const supports = item.status === 'ACCEPTED';
            const contradicts = item.status === 'CONTRADICTED';
            const colour = supports ? STATUS.good : contradicts ? STATUS.badSoft : INK.muted;
            return (
              <g key={`proof-${item._id}`}>
                <line x1={node.x} y1={node.y} x2={x} y2={y} stroke={colour} strokeWidth="0.8" opacity="0.4" />
                <motion.circle
                  cx={x}
                  cy={y}
                  r={7}
                  fill={SURFACE.page}
                  stroke={colour}
                  strokeWidth="1.2"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.35 }}
                />
                {contradicts ? <circle cx={x} cy={y} r={2} fill={colour} /> : null}
                {supports ? (
                  <path d={`M ${x - 3} ${y} l 2.2 2.4 l 4 -4.6`} fill="none" stroke={colour} strokeWidth="1.4" strokeLinecap="round" />
                ) : null}
              </g>
            );
          })
        )}

        {/* Condition nodes */}
        {layout.map((node, index) => {
          const meta = conditionMeta(node.condition.status);
          const isActive = String(node.condition._id) === String(hovered ?? selectedConditionId);
          const isVerified = ['VERIFIED', 'WAIVED'].includes(node.condition.status);
          return (
            <motion.g
              key={node.condition._id}
              onMouseEnter={() => setHovered(node.condition._id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectCondition?.(node.condition)}
              className="cursor-pointer"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, delay: 0.05 * index }}
            >
              {isActive ? <circle cx={node.x} cy={node.y} r={34} fill={meta.hex} opacity="0.09" /> : null}
              <circle
                cx={node.x}
                cy={node.y}
                r={24}
                fill={SURFACE.raised}
                stroke={meta.hex}
                strokeWidth={isActive ? 2 : 1.3}
                opacity={isVerified ? 1 : 0.9}
              />
              <text
                x={node.x}
                y={node.y + 4}
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
                fontSize="12"
                fill={meta.hex}
              >
                {String(index + 1).padStart(2, '0')}
              </text>
              {node.overflow ? (
                <text
                  x={node.x + 28}
                  y={node.y - 20}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                  fill={INK.muted}
                >
                  +{node.overflow}
                </text>
              ) : null}
            </motion.g>
          );
        })}

        {/* The amount at the centre — the promise itself */}
        <circle cx={CENTRE} cy={CENTRE} r={86} fill={SURFACE.page} stroke={SURFACE.hairline} strokeWidth="1" />
        <circle cx={CENTRE} cy={CENTRE} r={78} fill="none" stroke={STATUS.accent} strokeWidth="1" opacity="0.5" />
        <text
          x={CENTRE}
          y={CENTRE - 4}
          textAnchor="middle"
          className="tnum"
          fontFamily="Fraunces, Georgia, serif"
          fontSize={promise?.amount >= 1000000 ? 24 : 30}
          fill={INK.primary}
        >
          {promise ? formatMoney(promise.amount, promise.currency, { compact: true }) : '—'}
        </text>
        <text x={CENTRE} y={CENTRE + 22} textAnchor="middle" fontSize="10.5" fill={INK.dim}>
          <tspan className="tnum" fontFamily="JetBrains Mono, monospace">
            {verifiedCount}/{conditions.length}
          </tspan>
          <tspan dx="4">proven</tspan>
        </text>
      </svg>

      {/* Reading of whichever node is under the cursor */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4">
        {active ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md border border-ink-300 bg-ink-800/95 px-4 py-3 backdrop-blur"
          >
            <div className="flex items-center gap-2">
              <span className={`h-1 w-1 rounded-full ${conditionMeta(active.condition.status).dot}`} />
              <span className="label">
                {active.condition.label} · {conditionMeta(active.condition.status).label} ·{' '}
                {active.condition.confidence}%
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-snug text-paper-100">{active.condition.description}</p>
            <p className="mt-1.5 label text-paper-400">
              {active.proof.length
                ? `${active.proof.length} proof · ${active.proof
                    .map((item) => evidenceMeta(item.status).label)
                    .slice(0, 3)
                    .join(', ')}`
                : 'No proof filed'}
            </p>
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}
