import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { statusMeta } from '../../utils/status.js';
import { formatMoney, daysUntil } from '../../utils/format.js';
import { INK, STATUS, SURFACE } from '../charts/palette.js';

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

/** Keeps a dragged node inside the field, with room under it for its two labels. */
const EDGE = 6;
const LABEL_ROOM = 34;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Clear air between two rings, so neighbours read as separate objects. */
const NODE_GAP = 10;

/** How far a press has to travel before it stops being a click. */
const DRAG_THRESHOLD = 2;

export function PromiseConstellation({ nodes = [], onInspect }) {
  const navigate = useNavigate();
  const svgRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  /** Where a node has been dragged to, in viewBox units, keyed by promise id. */
  const [offsets, setOffsets] = useState({});
  const [dragging, setDragging] = useState(null);
  const drag = useRef(null);
  /**
   * Counterparties whose photo would not load — a revoked Google URL, an account
   * deleted since. Recorded so the node falls back to the plain ring instead of
   * showing a broken image, and so it is not retried on every re-render.
   */
  const [photoFailed, setPhotoFailed] = useState(() => new Set());

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

    /**
     * Push apart any two rings that landed on the same spot.
     *
     * Orbit and angle decide where a promise sits, and nothing in that says two
     * promises on different orbits cannot arrive at the same place — a ₹500 ring
     * came to rest directly on top of a ₹10 one, and the label of each printed
     * through the other. A few relaxation passes separate overlapping pairs
     * along the line between them, which preserves the orbit reading (state) and
     * the size reading (amount) while making both legible.
     */
    for (let pass = 0; pass < 40; pass += 1) {
      let moved = false;
      for (let i = 0; i < result.length; i += 1) {
        for (let j = i + 1; j < result.length; j += 1) {
          const a = result[i];
          const b = result[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 0.01;
          const wanted = a.r + b.r + NODE_GAP;
          if (distance >= wanted) continue;

          const shift = (wanted - distance) / 2;
          const ux = dx / distance;
          const uy = dy / distance;
          a.x -= ux * shift;
          a.y -= uy * shift;
          b.x += ux * shift;
          b.y += uy * shift;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Relaxation can walk a node off the edge; the field is what it must fit in.
    for (const entry of result) {
      entry.x = clamp(entry.x, entry.r + EDGE, VIEW_W - entry.r - EDGE);
      entry.y = clamp(entry.y, entry.r + EDGE, VIEW_H - entry.r - LABEL_ROOM);
    }

    return result;
  }, [nodes]);

  /**
   * Which amounts cannot be shown without lying about whose they are.
   *
   * A label belongs directly under its own ring. Nudging it aside to dodge a
   * neighbour breaks that: the first attempt at this pushed labels downward
   * until they were clear, and "₹10" ended up sitting under the ₹500 ring,
   * reading as its amount. A label attached to the wrong node is worse than no
   * label — so where one cannot sit in its own place, it is simply not drawn,
   * and hovering the ring shows it.
   *
   * Recomputed when a node is dragged, because dragging moves the label too.
   */
  const crowdedLabels = useMemo(() => {
    const LINE = 13;
    const HALF_WIDTH = 26;
    const shown = [];
    const hidden = new Set();

    const seat = (entry) => {
      const nudge = offsets[entry.node.id];
      return {
        cx: entry.x + (nudge?.dx ?? 0),
        cy: entry.y + (nudge?.dy ?? 0) + entry.r + 16,
      };
    };

    // A label sits below its own ring, which puts it exactly where a ring on the
    // next orbit out may already be.
    const discs = placed.map((entry) => {
      const nudge = offsets[entry.node.id];
      return {
        id: entry.node.id,
        x: entry.x + (nudge?.dx ?? 0),
        y: entry.y + (nudge?.dy ?? 0),
        r: entry.r,
      };
    });

    // Largest first: when two amounts compete for the same space, the bigger
    // promise is the one worth naming.
    for (const entry of [...placed].sort((a, b) => b.r - a.r)) {
      const { cx, cy } = seat(entry);
      const overLabel = shown.some(
        (other) => Math.abs(other.cx - cx) < HALF_WIDTH * 2 && Math.abs(other.cy - cy) < LINE
      );
      const overRing = discs.some(
        (disc) => disc.id !== entry.node.id && Math.hypot(disc.x - cx, disc.y - cy) < disc.r + 5
      );
      if (overLabel || overRing) hidden.add(entry.node.id);
      else shown.push({ cx, cy });
    }
    return hidden;
  }, [placed, offsets]);

  const active = placed.find((entry) => entry.node.id === hovered);

  /**
   * Screen pixels → viewBox units. The field is fluid, so the same drag covers
   * a different number of user units on a laptop and on a wide monitor.
   */
  const toViewBox = (pixels) => {
    const width = svgRef.current?.getBoundingClientRect().width || VIEW_W;
    return (pixels * VIEW_W) / width;
  };

  const startDrag = (event, entry) => {
    // Without this a drag across the field selects the labels instead.
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      id: entry.node.id,
      clientX: event.clientX,
      clientY: event.clientY,
      origin: offsets[entry.node.id] ?? { dx: 0, dy: 0 },
      moved: false,
    };
    setDragging(entry.node.id);
  };

  const moveDrag = (event, entry) => {
    const current = drag.current;
    if (!current || current.id !== entry.node.id) return;

    const travelledX = toViewBox(event.clientX - current.clientX);
    const travelledY = toViewBox(event.clientY - current.clientY);
    if (Math.abs(travelledX) > DRAG_THRESHOLD || Math.abs(travelledY) > DRAG_THRESHOLD) {
      current.moved = true;
    }

    const dx = current.origin.dx + travelledX;
    const dy = current.origin.dy + travelledY;
    setOffsets((all) => ({
      ...all,
      [entry.node.id]: {
        dx: clamp(dx, EDGE + entry.r - entry.x, VIEW_W - EDGE - entry.r - entry.x),
        dy: clamp(dy, EDGE + entry.r - entry.y, VIEW_H - LABEL_ROOM - entry.r - entry.y),
      },
    }));
  };

  const endDrag = (event, entry) => {
    const current = drag.current;
    drag.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A press that never travelled is still a click, and still opens the promise.
    if (current?.id === entry.node.id && !current.moved) {
      if (onInspect) onInspect(entry.node);
      else navigate(`/promises/${entry.node.id}`);
    }
  };

  return (
    <div className="relative">
      {/* Capped height keeps the field on one screen; the viewBox letterboxes. */}
      <svg
        ref={svgRef}
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
            stroke={SURFACE.hairlineSoft}
            strokeWidth="1"
            strokeDasharray="2 8"
            opacity="0.55"
          />
        ))}

        <circle cx={VIEW_W / 2} cy={VIEW_H / 2} r="3" fill={STATUS.accent} opacity="0.5" />

        {placed.map((entry, index) => {
          const { node, r } = entry;
          const nudge = offsets[node.id];
          const x = entry.x + (nudge?.dx ?? 0);
          const y = entry.y + (nudge?.dy ?? 0);
          const meta = statusMeta(node.status);
          const isHovered = hovered === node.id;
          const isDragging = dragging === node.id;
          const remaining = daysUntil(node.deadline);
          const photo = photoFailed.has(node.id) ? null : node.counterparty?.avatar;
          /**
           * The confidence arc is a fixed 3px band at r-5, so the photo cannot
           * grow past r-7 whatever the node's size — a small promise gets a
           * small face rather than a cropped arc. That is the right trade: on a
           * field where most amounts cluster low, the small nodes are precisely
           * the ones a name would never fit on.
           */
          const photoR = r - 8;
          const dimmed = ['CANCELLED', 'EXPIRED'].includes(node.status);
          const urgent = remaining !== null && remaining <= 3 && !['SETTLING', 'FULFILLED', 'CANCELLED'].includes(node.status);

          return (
            <motion.g
              key={node.id}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: Math.min(0.4, index * 0.035) }}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onPointerDown={(event) => startDrag(event, entry)}
              onPointerMove={(event) => moveDrag(event, entry)}
              onPointerUp={(event) => endDrag(event, entry)}
              onPointerCancel={() => {
                drag.current = null;
                setDragging(null);
              }}
              // Touch must drag the node rather than scroll the page under it.
              style={{ touchAction: 'none' }}
              className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
            >
              {urgent ? (
                <circle cx={x} cy={y} r={r + 6} fill="none" stroke={meta.hex} strokeWidth="1" className="animate-pulse-ring" />
              ) : null}
              {isHovered ? <circle cx={x} cy={y} r={r + 12} fill={meta.hex} opacity="0.08" /> : null}

              {isDragging ? <circle cx={x} cy={y} r={r + 12} fill={meta.hex} opacity="0.14" /> : null}

              <circle
                cx={x}
                cy={y}
                r={r}
                fill={SURFACE.page}
                stroke={meta.hex}
                strokeWidth={isHovered || isDragging ? 2 : 1.2}
              />

              {/*
                * Who is on the other side, as a face.
                *
                * The ring already says how much and what state; it cannot say
                * whom. A payer scanning this field wants to find a person, and a
                * photo is read far faster than a name would be at this size.
                *
                * Drawn inside the confidence arc so it never covers it. A
                * counterparty with no photo on their account keeps the plain
                * ring, unchanged.
                */}
              {photo && photoR >= 6 ? (
                <foreignObject
                  x={x - photoR}
                  y={y - photoR}
                  width={photoR * 2}
                  height={photoR * 2}
                  // The node beneath owns the drag; the picture must not eat it.
                  style={{ pointerEvents: 'none' }}
                >
                  <img
                    src={photo}
                    alt=""
                    // Google serves these only when no referrer is sent.
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setPhotoFailed((current) => new Set(current).add(node.id))
                    }
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: '50%',
                      // A closed promise reads as past tense; its face does too.
                      filter: dimmed ? 'grayscale(1)' : 'none',
                      opacity: dimmed ? 0.45 : isHovered || isDragging ? 1 : 0.88,
                    }}
                  />
                </foreignObject>
              ) : null}

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

              {!crowdedLabels.has(node.id) || isHovered || isDragging ? (
                <text
                  x={x}
                  y={y + r + 16}
                  textAnchor="middle"
                  className="tnum"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="11"
                  fill={isHovered ? INK.primary : INK.muted}
                >
                  {formatMoney(node.amount, node.currency, { compact: true })}
                </text>
              ) : null}
              {/*
                * The state is already in the ring's colour, and the legend says
                * so. Printing it under every node as well doubled the height of
                * every label — which is what made them collide — to repeat
                * something the node had already said. It answers a hover.
                */}
              {isHovered || isDragging ? (
                <text
                  x={x}
                  y={y + r + 28}
                  textAnchor="middle"
                  fontSize="9"
                  fill={meta.hex}
                >
                  {meta.label}
                </text>
              ) : null}
            </motion.g>
          );
        })}
      </svg>

      {Object.keys(offsets).length ? (
        <button
          type="button"
          onClick={() => setOffsets({})}
          className="absolute right-3 top-3 label text-paper-400 transition-colors hover:text-paper-100"
        >
          Reset layout
        </button>
      ) : null}

      {active ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute left-1/2 top-3 w-[min(22rem,90%)] -translate-x-1/2 border border-ink-300 bg-ink-800/95 px-4 py-3 backdrop-blur"
        >
          <p className="truncate font-display text-[15px] text-paper-50">{active.node.title}</p>
          <p className="mt-1 label text-paper-400">
            {active.node.publicId} · {active.node.recipient} · {active.node.verifiedConditions}/
            {active.node.conditions} proven · {active.node.evidenceCount} proof
          </p>
        </motion.div>
      ) : null}
    </div>
  );
}
