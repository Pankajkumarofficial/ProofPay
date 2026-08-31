// @ts-check
/**
 * UTR validation.
 *
 * A UPI reference (RRN) is twelve digits with real structure, standardised by
 * NPCI: `Y DDD SSSSSSSS` — the last digit of the year, the Julian day of the
 * year, then an eight-digit System Trace Audit Number from the bank.
 *
 * That structure is what makes a lazy fake visible: "123456789012" decodes to
 * day 234 of a year ending in 1, which is not a reference for a payment
 * authorised today.
 *
 * It is a convention, though, not a rule: NPCI fixes the length at
 * twelve digits and leaves the composition to the issuing bank, and real UPI
 * apps hand out references that do not decode as a date at all. So the date is
 * *graded*, never enforced — refusing a reference the payer read off their bank
 * app would strand a promise whose money has genuinely moved, which is the worse
 * of the two failures by a distance.
 *
 * What this can and cannot do, stated plainly because the app says it out loud:
 *
 *   CAN  — reject what cannot be a reference at all: wrong length, letters,
 *          all-same digits, the obvious placeholders. And grade the rest, so a
 *          reference that fits the date of the transfer is told apart from one
 *          taken purely on the payer's word.
 *   CANNOT — confirm with the bank that money actually moved. That needs bank
 *            or payment-aggregator access. Nothing recorded here is ever
 *            presented as provider-confirmed.
 */

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
 * `authorisedAt` is when the payer released the money. A reference whose date
 * prefix sits near that release reads as consistent with this transfer; one
 * that does not is still recorded, because the structure is a convention rather
 * than a rule (see the note on grading above).
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

  const reading = readDate(utr, { authorisedAt, toleranceDays });

  return {
    valid: true,
    utr,
    stampedDate: reading.stampedDate,
    /**
     * Named so nothing downstream can mistake either grade for a bank
     * confirmation. 'format-checked' is the stronger of the two: the reference
     * decodes to a date that fits this transfer.
     */
    verification: reading.consistent ? 'format-checked' : 'payer-reported',
    /** Why it could not be date-checked. Shown wherever the UTR is shown. */
    note: reading.note,
  };
}

/**
 * Reads the `Y DDD` prefix, and says whether it fits the transfer.
 *
 * Never throws a reference out: it returns a reason the reference could not be
 * placed, which travels with the record instead of blocking it.
 */
function readDate(utr, { authorisedAt, toleranceDays }) {
  const unread = (note) => ({ consistent: false, stampedDate: null, note });

  const yearDigit = Number(utr[0]);
  const dayOfYear = Number(utr.slice(1, 4));

  if (dayOfYear < 1 || dayOfYear > 366) {
    return unread(
      `Digits 2–4 of this reference read ${utr.slice(1, 4)}, which is not a day of the year, ` +
        'so it could not be checked against the date of your payment.'
    );
  }

  const stamped = decodeDate(yearDigit, dayOfYear, authorisedAt);
  if (!stamped) {
    return unread('The date in this reference could not be read, so it was not checked against your payment.');
  }

  const authorisedDay = new Date(
    Date.UTC(authorisedAt.getUTCFullYear(), authorisedAt.getUTCMonth(), authorisedAt.getUTCDate())
  );
  const driftDays = Math.round((stamped.getTime() - authorisedDay.getTime()) / DAY);
  const on = stamped.toISOString().slice(0, 10);

  if (driftDays < -toleranceDays) {
    return unread(`This reference is dated ${on}, before you authorised the payment — check it is the right one.`);
  }
  if (stamped.getTime() > Date.now() + toleranceDays * DAY) {
    return unread(`This reference is dated ${on}, which is in the future — check it is the right one.`);
  }

  return { consistent: true, stampedDate: stamped, note: null };
}
