export const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));
/** 0..1 → 0..100 integer, the unit every score is stored and displayed in. */
export const toScore = (value) => Math.round(clamp(value) * 100);
export const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
