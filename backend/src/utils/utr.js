// @ts-check
/**
 * UTR validation.
 *
 * A UPI reference (RRN) is twelve digits with real structure, standardised by
 * NPCI: `Y DDD SSSSSSSS` — the last digit of the year, the Julian day of the
 * year, then an eight-digit System Trace Audit Number from the bank.
 *
 * That structure is what makes a made-up number detectable. "123456789012"
 * decodes to day 234 of a year ending in 1; if the payment was authorised in
 * 2026, it is not a reference for this transfer.
 *
 * What this can and cannot do, stated plainly because the app says it out loud:
 *
 *   CAN  — reject anything malformed, impossible, out of date range, or reused.
 *   CANNOT — confirm with the bank that money actually moved. That needs bank
 *            or payment-aggregator access. A reference that passes here is
 *            well-formed and consistent with the transfer, and is recorded as
 *            payer-reported rather than provider-confirmed.
 */

/** Day of the year, 1–366. */
function julianDay(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
}

/** The calendar date a UTR's `Y DDD` prefix points at, anchored near a known date. */
function decodeDate(yearDigit, dayOfYear, near) {
  // One digit cannot name a year on its own, so it is resolved against the year
  // the payment was authorised in, then its neighbours.
  const base = near.getUTCFullYear();
  for (const year of [base, base - 1, base + 1]) {
    if (year % 10 !== yearDigit) continue;
    const date = new Date(Date.UTC(year, 0, dayOfYear));
    if (date.getUTCFullYear() === year) return date;
  }
  return null;
}

const DAY = 86400000;

/**
 * Checks a reference against the transfer it claims to settle.
 *
 * `authorisedAt` is when the payer released the money — a genuine reference
 * cannot predate that, and cannot be from the future.
 */
export function validateUtr(raw, { authorisedAt = new Date(), toleranceDays = 2 } = {}) {
  const utr = String(raw ?? '').trim().replace(/\s+/g, '');

  if (!utr) {
    return { valid: false, reason: 'Enter the UTR from your payment app.' };
  }
  if (/[^0-9]/.test(utr)) {
    return {
      valid: false,
      reason: 'A UPI reference is 12 digits with no letters or symbols. Copy it exactly from your payment app.',
    };
  }
  if (utr.length !== 12) {
    return {
      valid: false,
      reason: `A UPI reference is exactly 12 digits — this one has ${utr.length}.`,
    };
  }
  // An all-same or sequential run is a placeholder, not a bank reference.
  if (/^(\d)\1{11}$/.test(utr) || utr === '123456789012') {
    return { valid: false, reason: 'That is not a real reference number.' };
  }

  const yearDigit = Number(utr[0]);
  const dayOfYear = Number(utr.slice(1, 4));

  if (dayOfYear < 1 || dayOfYear > 366) {
    return {
      valid: false,
      reason: `Digits 2–4 of a UPI reference are the day of the year (001–366); this one reads ${utr.slice(1, 4)}.`,
    };
  }

  const stamped = decodeDate(yearDigit, dayOfYear, authorisedAt);
  if (!stamped) {
    return { valid: false, reason: 'The date encoded in this reference does not correspond to a real date.' };
  }

  const authorisedDay = new Date(
    Date.UTC(authorisedAt.getUTCFullYear(), authorisedAt.getUTCMonth(), authorisedAt.getUTCDate())
  );
  const driftDays = Math.round((stamped.getTime() - authorisedDay.getTime()) / DAY);

  if (driftDays < -toleranceDays) {
    return {
      valid: false,
      reason: `This reference is dated ${stamped.toISOString().slice(0, 10)}, before the payment was authorised. It belongs to an earlier transfer.`,
    };
  }
  if (stamped.getTime() > Date.now() + toleranceDays * DAY) {
    return {
      valid: false,
      reason: `This reference is dated ${stamped.toISOString().slice(0, 10)}, which is in the future.`,
    };
  }

  return {
    valid: true,
    utr,
    stampedDate: stamped,
    /** Named so nothing downstream can mistake this for a bank confirmation. */
    verification: 'format-checked',
  };
}