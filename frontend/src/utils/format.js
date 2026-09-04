/** Formatting only. */

const CURRENCY_LOCALE = {
  INR: 'en-IN',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  AED: 'en-AE',
  SGD: 'en-SG',
};

export function formatMoney(amount, currency = 'INR', { compact = false } = {}) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  const value = Number(amount);
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    ...(compact && Math.abs(value) >= 10000 ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
  }).format(value);
}

export function currencySymbol(currency = 'INR') {
  const parts = new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-IN', {
    style: 'currency',
    currency,
  }).formatToParts(0);
  return parts.find((part) => part.type === 'currency')?.value ?? currency;
}

export const formatNumber = (value) =>
  value === null || value === undefined ? '—' : new Intl.NumberFormat('en-IN').format(value);

export function formatDate(value, { withTime = false } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export const formatTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '—';

export function relativeTime(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return 'just now';
  if (abs < hour) return formatter.format(Math.round(diff / minute), 'minute');
  if (abs < day) return formatter.format(Math.round(diff / hour), 'hour');
  if (abs < 30 * day) return formatter.format(Math.round(diff / day), 'day');
  if (abs < 365 * day) return formatter.format(Math.round(diff / (30 * day)), 'month');
  return formatter.format(Math.round(diff / (365 * day)), 'year');
}

/** Days between now and a deadline; negative once it has passed. */
export function daysUntil(value) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export const titleFromEnum = (value = '') =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
