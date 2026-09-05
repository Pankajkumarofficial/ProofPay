/** Detects a document whose identifying fields were never filled in. */

/**
 * `[Your full name]`, `[DD Month YYYY]`, `<amount>`, `{{recipient}}`.
 * Bracketed spans short enough to be a field rather than a sentence.
 */
const BRACKETED = /(\[[^\]\n]{1,40}\]|<[a-z][^>\n]{1,38}>|\{\{[^}\n]{1,38}\}\})/gi;

/** A signature rule with nothing written on it. */
const SIGNATURE_RULE = /_{6,}/g;

/** Date and name shapes that are instructions to a filler, not values. */
const NAMED_PLACEHOLDER =
  /\b(dd[\s/-]?month[\s/-]?yyyy|dd[\s/-]?mm[\s/-]?yyyy|yyyy-mm-dd|your full name|full name here|insert [a-z ]{3,20}|lorem ipsum|tbd|to be filled)\b/gi;

/** A bracketed span that is prose rather than a field — "[sic]", "[1]". */
const CITATION = /^\[(?:\d{1,3}|sic|…|\.\.\.)\]$/i;

/**
 * Whether an artefact is a blank form.
 *
 * A template's body makes every claim the real document would: the tests pass,
 * the work was delivered, the payer approves. What it lacks is anyone saying
 * so — the name, the date and the signature are still square brackets. Judged
 * on its contents alone it reads as perfect proof, which is exactly what
 * happened: an unfilled acceptance certificate verified a condition at 95%
 * because it listed five PASS rows, and nothing asked whether a person had
 * ever put their name to it.
 *
 * Deliberately deterministic and applied before any model call. The claim that
 * ProofPay makes no false accepts cannot rest on a provider being observant.
 */
export function unfilledPlaceholders(text) {
  if (!text || typeof text !== 'string') return [];
  const found = [];

  for (const match of text.match(BRACKETED) ?? []) {
    if (!CITATION.test(match)) found.push(match);
  }
  for (const match of text.match(NAMED_PLACEHOLDER) ?? []) found.push(match);
  for (const match of text.match(SIGNATURE_RULE) ?? []) found.push('(blank signature line)');

  return found;
}

/**
 * Three or more unfilled fields is a form, not a record.
 *
 * One or two can be a quirk of formatting or a genuine citation; a document
 * carrying several is one nobody completed. The threshold errs towards letting
 * proof through, because the cost of a wrongly refused proof is a person
 * re-filing it, and the cost of a wrongly accepted one is money moving.
 */
export function looksLikeTemplate(text) {
  return unfilledPlaceholders(text).length >= 3;
}

/** The first few, for an explanation that shows its working. */
export function placeholderSample(text, limit = 4) {
  const unique = [...new Set(unfilledPlaceholders(text))];
  return unique.slice(0, limit);
}
