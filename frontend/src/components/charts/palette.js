/**
 * Chart and diagram colour, decided once.
 *
 * SVG cannot reach Tailwind's classes for a `fill` computed at render time, so
 * these resolve through the same CSS variables the utilities do. That is what
 * keeps a gauge or a constellation in step when the theme flips — the values
 * below never change, the variables underneath them do.
 *
 * The two categorical hues were validated against the chart surface for the
 * OKLCH lightness band, chroma floor, colour-vision separation (ΔE 22.5 protan
 * / 20.0 tritan), normal-vision separation (ΔE 23.7) and 3:1 contrast. The
 * light theme keeps the same gold/blue pairing — the safest available under
 * every form of colour blindness, and separated by lightness as well as hue —
 * darkened so both clear 3:1 against paper, where the dark theme's values
 * measured 2.8:1 and would have failed.
 *
 * Status hues are a separate, reserved set: they encode state, always travel
 * with a written label, and are never borrowed as "another series".
 */

/** A palette variable, in a form an SVG attribute accepts. */
const token = (name) => `rgb(var(--${name}))`;

export const SERIES = {
  created: { key: 'created', label: 'Promised', colour: token('chart-series-1') },
  fulfilled: { key: 'fulfilled', label: 'Fulfilled', colour: token('chart-series-2') },
};

export const SERIES_ORDER = [SERIES.created, SERIES.fulfilled];

export const CHART_SURFACE = token('ink-800');
export const GRID = token('ink-400');
export const AXIS_TEXT = token('paper-400');
export const LABEL_TEXT = token('paper-300');

/**
 * The rest of the themed surface, for the diagrams that are not charts — the
 * confidence dial, the promise map, the constellation.
 */
export const SURFACE = {
  page: token('ink-800'),
  raised: token('ink-700'),
  well: token('ink-500'),
  hairline: token('ink-300'),
  hairlineSoft: token('ink-400'),
};

export const INK = {
  primary: token('paper-50'),
  muted: token('paper-300'),
  dim: token('paper-400'),
};

/** State, always paired with a written label — never colour alone. */
export const STATUS = {
  accent: token('brass-300'),
  accentSoft: token('brass-200'),
  good: token('sage-300'),
  warn: token('ochre-300'),
  bad: token('rust-400'),
  badSoft: token('rust-300'),
  neutral: token('slate-300'),
};

/** One hue, strongest→faintest, for magnitude-only charts. */
export const SEQUENTIAL = [
  token('brass-100'),
  token('brass-200'),
  token('brass-300'),
  token('brass-400'),
  token('brass-500'),
];

export const sequentialStep = (index, total) =>
  SEQUENTIAL[Math.min(SEQUENTIAL.length - 1, Math.floor((index / Math.max(1, total - 1)) * (SEQUENTIAL.length - 1)))];
