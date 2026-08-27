/**
 * Chart colour, decided once.
 *
 * The two categorical hues were validated against the chart surface (#131210)
 * for the OKLCH lightness band, chroma floor, colour-vision separation
 * (ΔE 22.5 protan / 20.0 tritan), normal-vision separation (ΔE 23.7) and 3:1
 * contrast. They are assigned to entities in fixed order and never cycled.
 *
 * Status hues are a separate, reserved set: they encode state, always travel
 * with a written label, and are never borrowed as "another series".
 */
export const SERIES = {
  created: { key: 'created', label: 'Promised', colour: '#B9862C' },
  fulfilled: { key: 'fulfilled', label: 'Fulfilled', colour: '#5F7FC4' },
};

export const SERIES_ORDER = [SERIES.created, SERIES.fulfilled];

export const CHART_SURFACE = '#131210';
export const GRID = '#2F2822';
export const AXIS_TEXT = '#6F675A';
export const LABEL_TEXT = '#9A907F';

/** One hue, light→dark, for magnitude-only charts. */
export const SEQUENTIAL = ['#F0D8A4', '#E3BE7F', '#D9A441', '#B9862C', '#8E651F'];

export const sequentialStep = (index, total) =>
  SEQUENTIAL[Math.min(SEQUENTIAL.length - 1, Math.floor((index / Math.max(1, total - 1)) * (SEQUENTIAL.length - 1)))];
