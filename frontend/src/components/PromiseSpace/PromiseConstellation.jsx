import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { statusMeta } from '../../utils/status.js';
import { formatMoney, daysUntil } from '../../utils/format.js';

/**
 * Promise Space as a field of objects.
 *
 * Each node is one promise row: its ring size comes from the amount relative to
 * the user's own largest promise, its orbit from status, its fill from Proof
 * Confidence. Add a promise and a node appears; prove one and it moves inward.
 * The component receives nodes and renders exactly those.
 */
const VIEW_W = 1000;
const VIEW_H = 440;
// Independent x/y radii: the field is wider than it is tall, and the orbits
// should fill it rather than letterbox inside it.
const UNIT_X = VIEW_W / 2 - 96;
const UNIT_Y = VIEW_H / 2 - 52;

/** Orbits, innermost first: the closer to the centre, the closer to settled. */
const ORBITS = [
  { statuses: ['FULFILLED'], radius: 0.32 },
  // Released, waiting on the money: one ring out from settled.
  { statuses: ['SETTLING'], radius: 0.41 },
  { statuses: ['READY_TO_FULFILL'], radius: 0.5 },
  { statuses: ['PARTIALLY_VERIFIED', 'ACTIVE'], radius: 0.66 },
  { statuses: ['FUNDED', 'DRAFT'], radius: 0.82 },
  { statuses: ['CONTESTED', 'EXPIRED', 'CANCELLED'], radius: 0.97 },
];

const orbitFor = (status) => ORBITS.findIndex((orbit) => orbit.statuses.includes(status));

export function PromiseConstellation({ nodes = [], onInspect }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(null);

  const placed = useMemo(() => {
    const maxAmount = Math.max(...nodes.map((node) => node.amount), 1);
    const centreX = VIEW_W / 2;
    const centreY = VIEW_H / 2;

    // Group by orbit so promises in the same state share a ring and spread evenly.
    const groups = new Map();
    for (const node of nodes) {
      const index = orbitFor(node.status);
      const key = index === -1 ? ORBITS.length - 1 : index;
      groups.set(key, [...(groups.get(key) ?? []), node]);
    }

    const result = [];
    for (const [orbitIndex, group] of groups) {
      const orbit = ORBITS[orbitIndex];
      group.forEach((node, index) => {
        // A fixed phase offset per orbit keeps rings from lining up into spokes.
        const angle = (360 / group.length) * index - 90 + orbitIndex * 23;
        const radians = (angle * Math.PI) / 180;
        // Area, not radius, tracks the amount — so a 4× promise looks 4× bigger.
        const size = 15 + Math.sqrt(node.amount / maxAmount) * 20;
        result.push({
          node,
          x: centreX + UNIT_X * orbit.radius * Math.cos(radians),
          y: centreY + UNIT_Y * orbit.radius * Math.sin(radians),
          r: size,
          orbitIndex,
        });
      });
    }
    return result;
  }, [nodes]);

  const active = placed.find((entry) => entry.node.id === hovered);

  return (
    <div className="relative">
      {/* Capped height keeps the field on one screen; the viewBox letterboxes. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        role="img"
        aria-label="Promise Space"
      >
        {ORBITS.map((orbit, index) => (
          <ellipse
            key={index}
            cx={VIEW_W / 2}
            cy={VIEW_H / 2}
            rx={UNIT_X * orbit.radius}
            ry={UNIT_Y * orbit.radius}
            fill="none"
            stroke="#2F2822"
            strokeWidth="1"
            strokeDasharray="2 8"
            opacity="0.55"
          />
        ))}

        <circle cx={VIEW_W / 2} cy={VIEW_H / 2} r="3" fill="#D9A441" opacity="0.5" />

        {placed.map(({ node, x, y, r }, index) => {
          const meta = statusMeta(node.status);
          const isHovered = hovered === node.id;
          const remaining = daysUntil(node.deadline);
          const urgent = remaining !== null && remaining <= 3 && !['SETTLING', 'FULFILLED', 'CANCELLED'].includes(node.status);

          return (
            <motion.g
              key={node.id}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: Math.min(0.4, index * 0.035) }}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => (onInspect ? onInspect(node) : navigate(`/promises/${node.id}`))}
              className="cursor-pointer"
            >
              {urgent ? (
                <circle cx={x} cy={y} r={r + 6} fill="none" stroke={meta.hex} strokeWidth="1" className="animate-pulse-ring" />
              ) : null}
              {isHovered ? <circle cx={x} cy={y} r={r + 12} fill={meta.hex} opacity="0.08" /> : null}

              <circle cx={x} cy={y} r={r} fill="#131210" stroke={meta.hex} strokeWidth={isHovered ? 2 : 1.2} />

              {/* Filled sector = Proof Confidence on this promise */}
              <circle
                cx={x}
                cy={y}
                r={r - 5}
                fill="none"
                stroke={meta.hex}
                strokeWidth="3"
                strokeDasharray={`${(2 * Math.PI * (r - 5) * (node.proofConfidence ?? 0)) / 100} ${2 * Math.PI * (r - 5)}`}
                transform={`rotate(-90 ${x} ${y})`}
                opacity="0.85"
              />

              <text
                x={x}
                y={y + r + 16}
                textAnchor="middle"
                className="tnum"
                fontFamily="JetBrains Mono, monospace"
                fontSize="11"
                fill={isHovered ? '#F6F1E7' : '#9A907F'}
              >
                {formatMoney(node.amount, node.currency, { compact: true })}
              </text>
              <text
                x={x}
                y={y + r + 28}
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
                fontSize="8"
                letterSpacing="1.6"
                fill={meta.hex}
                opacity="0.8"
              >
                {meta.label.toUpperCase()}
              </text>
            </motion.g>
          );
        })}
      </svg>

      {active ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute left-1/2 top-3 w-[min(22rem,90%)] -translate-x-1/2 border border-ink-300 bg-ink-800/95 px-4 py-3 backdrop-blur"
        >
          <p className="truncate font-display text-[15px] text-paper-50">{active.node.title}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-paper-400">
            {active.node.publicId} · {active.node.recipient} · {active.node.verifiedConditions}/
            {active.node.conditions} proven · {active.node.evidenceCount} proof
          </p>
        </motion.div>
      ) : null}
    </div>
  );
}
