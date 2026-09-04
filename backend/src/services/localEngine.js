import { CONDITION_TYPE, VERIFICATION_METHOD, VERDICT } from '../models/constants.js';

/** The deterministic Proof Engine. */

/* ─────────────────────────── shared lexicons ─────────────────────────── */

/** The spellings of "rupees" that actually turn up in typed sentences. */
const RUPEE_WORD = String.raw`rup(?:ee|pee|pe|e|aye|ay|iya|ya)s?`;

/** Nouns that make a number a count rather than a price. */
const COUNTED_NOUN = /^(?:conditions?|milestones?|screens?|pages?|tests?|rounds?|revisions?|items?|files?|photos?|images?|drafts?|versions?|days?|weeks?|months?|hours?|people|users?|times?|%)/;

/** Words that cannot be a name, so a number just past them is not a price either. */
const NOT_A_NAME_RUN = /^(?:when|once|after|if|the|a|an|and|or|for|to|out|back|up|only|about|around|just|at|least|most|total|of)$/;

/** Verbs that make the number after them money. */
const PAYMENT_VERB = 'pay|paying|pays|paid|owe|owes|owed|reward|rewards|send|sending|transfer|transfers|release|releases|settle|settles';

/** Anything that marks a number as money, in either position around it. */
const CURRENCY_TOKEN = String.raw`₹|\$|€|£|rs\.?|inr|usd|dollars?|eur|euros?|gbp|pounds?|aed|sgd|${RUPEE_WORD}`;

const CURRENCY_SIGNS = [
  [new RegExp(String.raw`₹|\brs\.?\b|\binr\b|\b${RUPEE_WORD}\b`, 'i'), 'INR'],
  [/\$|\busd\b|dollars?/i, 'USD'],
  [/€|\beur\b|euros?/i, 'EUR'],
  [/£|\bgbp\b|pounds?/i, 'GBP'],
  [/\baed\b|dirhams?/i, 'AED'],
  [/\bsgd\b/i, 'SGD'],
];

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  fifty: 50, hundred: 100, thousand: 1000, lakh: 100000, crore: 10000000,
};

const AMBIGUOUS_TERMS = {
  good: ['Written client approval', 'Acceptance checklist signed off', 'Defined quality threshold met'],
  great: ['Written client approval', 'Acceptance checklist signed off'],
  nice: ['Written client approval', 'Design review signed off'],
  well: ['Acceptance checklist signed off', 'Automated test suite passes'],
  properly: ['Automated test suite passes', 'Acceptance checklist signed off'],
  proper: ['Automated test suite passes', 'Acceptance checklist signed off'],
  satisfactory: ['Written client approval', 'Defined quality threshold met'],
  satisfied: ['Written client approval', 'Acceptance checklist signed off'],
  quality: ['Defined quality threshold met', 'Acceptance checklist signed off', 'Peer review completed'],
  professional: ['Design review signed off', 'Acceptance checklist signed off'],
  decent: ['Acceptance checklist signed off', 'Defined quality threshold met'],
  adequate: ['Acceptance checklist signed off', 'Defined quality threshold met'],
  acceptable: ['Written client approval', 'Acceptance checklist signed off'],
  perfect: ['Zero open defects at handover', 'Automated test suite passes'],
  best: ['Defined quality threshold met', 'Peer review completed'],
  better: ['Measured improvement against a stated baseline'],
  clean: ['Code review approved', 'Linter passes with zero errors'],
  modern: ['Design review signed off against the agreed reference'],
  fast: ['Measured response time under a stated threshold'],
  quick: ['Delivered by an explicit calendar date'],
  soon: ['Delivered by an explicit calendar date'],
  timely: ['Delivered by an explicit calendar date'],
  reasonable: ['A stated numeric threshold both sides agree on'],
  appropriate: ['Acceptance checklist signed off'],
  complete: ['Every item on an agreed scope list delivered'],
  finished: ['Every item on an agreed scope list delivered'],
  happy: ['Written client approval'],
  satisfactorily: ['Written client approval', 'Acceptance checklist signed off'],
};

/** "24 passed, 0 failed", "completes without error", "error-free". */
const ABSENCE_PHRASES = [
  /\b(?:0|zero|no|none|nil)\s+(?:open\s+|known\s+|remaining\s+|outstanding\s+)?(?:tests?\s+)?(?:failed|failures|failing|errors|issues|defects|bugs|blockers|crashes)\b/gi,
  /\b(?:without|free of|free from|with no)\s+(?:any\s+)?(?:errors?|failures?|failing|issues?|defects?|bugs?|crashes?|problems?)\b/gi,
  /\b(?:error|bug|defect|crash)[-\s]free\b/gi,
  /\bno longer (?:failing|broken)\b/gi,
];

const neutraliseAbsences = (text) =>
  ABSENCE_PHRASES.reduce((value, pattern) => value.replace(pattern, ' '), text);

const NEGATIVE_SIGNALS = [
  'not working', 'not delivered', 'does not work', 'doesn\'t work', 'broken',
  'failed', 'failing', 'incomplete', 'missing', 'rejected', 'cancelled',
  'not done', 'no longer', 'unable to', 'could not', 'crash', 'error',
  'refused', 'not approved', 'disputed', 'never received',
];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'to',
  'of', 'in', 'on', 'for', 'with', 'that', 'this', 'it', 'as', 'at', 'by', 'from',
  'has', 'have', 'had', 'will', 'shall', 'should', 'must', 'all', 'when', 'once',
  'after', 'i', 'he', 'she', 'they', 'we', 'you', 'my', 'his', 'her', 'their',
]);

const CONDITION_SIGNATURES = [
  {
    match: /\btests?\b|\bqa\b|test suite|acceptance test|unit test|passes?\b|\bruns?\b|\bworks?\b|functional|operational/i,
    type: CONDITION_TYPE.TEST,
    method: VERIFICATION_METHOD.TEST_REPORT,
    evidence: ['Passing test report', 'CI run link'],
  },
  {
    match: /\bapprov|sign[- ]?off|accept(?:s|ed|ance)?\b|confirm/i,
    type: CONDITION_TYPE.APPROVAL,
    method: VERIFICATION_METHOD.MANUAL_APPROVAL,
    evidence: ['Written approval from the payer', 'Signed acceptance note'],
  },
  {
    match: /\bdeploy|live\b|hosted|url|link|website|site\b|launch|ship|publish|docs\b|documentation|release/i,
    type: CONDITION_TYPE.DELIVERABLE,
    method: VERIFICATION_METHOD.URL_CHECK,
    evidence: ['Deployed URL', 'Screenshot of the live page'],
  },
  {
    match: /\binvoice|receipt|purchase order|\bpo\b|billing/i,
    type: CONDITION_TYPE.MILESTONE,
    method: VERIFICATION_METHOD.DOCUMENT_REVIEW,
    evidence: ['Invoice PDF', 'Payment receipt'],
  },
  {
    match: /\bresponsive|design|mobile|ui\b|ux\b|accessib|performance|load time/i,
    type: CONDITION_TYPE.QUALITY,
    method: VERIFICATION_METHOD.AI_ASSESSMENT,
    evidence: ['Screenshots across device widths', 'Audit report'],
  },
  {
    match: /\bby (?:the )?\d|before|deadline|within \d|no later than/i,
    type: CONDITION_TYPE.TIMELINE,
    method: VERIFICATION_METHOD.DOCUMENT_REVIEW,
    evidence: ['Timestamped delivery confirmation'],
  },
  {
    match: /\bdeliver|hand over|submit|provide|send|complete|finish|build|develop/i,
    type: CONDITION_TYPE.DELIVERABLE,
    method: VERIFICATION_METHOD.AI_ASSESSMENT,
    evidence: ['Delivery confirmation', 'The delivered files or link'],
  },
];

const METHOD_PREFERRED_EVIDENCE = {
  [VERIFICATION_METHOD.URL_CHECK]: ['url', 'repository', 'screenshot', 'image'],
  [VERIFICATION_METHOD.TEST_REPORT]: ['test_report', 'document', 'url', 'repository'],
  [VERIFICATION_METHOD.DOCUMENT_REVIEW]: ['pdf', 'document', 'invoice', 'delivery_confirmation'],
  [VERIFICATION_METHOD.MANUAL_APPROVAL]: ['note', 'document', 'delivery_confirmation', 'pdf'],
  [VERIFICATION_METHOD.PARTICIPANT_CONFIRMATION]: ['note', 'delivery_confirmation'],
  [VERIFICATION_METHOD.AI_ASSESSMENT]: ['image', 'screenshot', 'pdf', 'document', 'url', 'note'],
};

/* ─────────────────────────── helpers ─────────────────────────── */

const tokenise = (text = '') =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s./-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

const unique = (list) => [...new Set(list)];
const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const clampScore = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));

function detectCurrency(text, fallback = 'INR') {
  for (const [pattern, code] of CURRENCY_SIGNS) if (pattern.test(text)) return code;
  return fallback;
}

function detectAmount(text) {
  const lower = text.toLowerCase();

  // "₹1.5 lakh", "2 crore", "10k", "45 thousand"
  const scaled = lower.match(/([\d,.]+)\s*(k|lakhs?|lacs?|crores?|thousand|million|mn)\b/);
  if (scaled) {
    const base = Number(scaled[1].replace(/,/g, ''));
    const unit = scaled[2];
    const multiplier =
      unit === 'k' || unit.startsWith('thousand') ? 1000
      : unit.startsWith('lakh') || unit.startsWith('lac') ? 100000
      : unit.startsWith('crore') ? 10000000
      : 1000000;
    if (Number.isFinite(base)) return Math.round(base * multiplier);
  }

  // "₹10,000" / "Rs 10000" / "$2,500.00" / "ruppes 10" — currency first.
  const plain = lower.match(
    new RegExp(String.raw`(?:${CURRENCY_TOKEN})\s*([\d][\d,]*(?:\.\d{1,2})?)`)
  );
  if (plain) {
    const value = Number(plain[1].replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }

  // "10 rupees" / "500 INR" / "20 dollars".
  const trailing = lower.match(
    new RegExp(String.raw`\b([\d][\d,]*(?:\.\d{1,2})?)\s*(?:${CURRENCY_TOKEN})\b`)
  );
  if (trailing) {
    const value = Number(trailing[1].replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }

  // A number the sentence itself calls money, with no currency token anywhere.
  const cued = detectCuedAmount(lower);
  if (cued !== null) return cued;

  // A bare number with a thousands separator or four-plus digits.
  const bare = lower.match(/\b(\d{1,3}(?:,\d{2,3})+|\d{4,})\b/);
  if (bare) {
    const value = Number(bare[1].replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }

  // "ten thousand rupees"
  const words = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|fifty)\s+(thousand|lakh|crore|hundred)\b/);
  if (words) return WORD_NUMBERS[words[1]] * WORD_NUMBERS[words[2]];

  return null;
}

const NOT_A_NAME = new Set([
  'i', 'we', 'they', 'he', 'she', 'it', 'the', 'a', 'an', 'my', 'our', 'your',
  'their', 'his', 'her', 'him', 'them', 'me', 'us', 'you', 'pay', 'paying',
  'please', 'out', 'to', 'when', 'once', 'after', 'if', 'and', 'for', 'back',
  'off', 'up', 'over', 'will', 'shall', 'about', 'around',
]);

const isCurrencyWord = (word) =>
  new RegExp(String.raw`^(?:${CURRENCY_TOKEN})$`, 'i').test(word.replace(/[.,]$/, ''));

const nameWords = (candidate) =>
  candidate
    .trim()
    .split(/\s+/)
    // "Pay Rahul Rs 10000" — the currency token is not part of the name.
    .filter((word) => word && !isCurrencyWord(word));

/** A number that only the wording marks as money. */
function detectCuedAmount(lower) {
  const NUMBER = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;

  const read = (raw, rest = '') => {
    if (COUNTED_NOUN.test(rest.trim())) return null;
    const value = Number(raw.replace(/,/g, ''));
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  };

  // "a total of 5", "totalling 1,200"
  const total = lower.match(new RegExp(String.raw`\b(?:a\s+)?total(?:l?ing)?\s+(?:of\s+)?${NUMBER}\b(.*)$`));
  if (total) {
    const value = read(total[1], total[2]);
    if (value !== null) return value;
  }

  // "250 total"
  const after = lower.match(new RegExp(String.raw`\b${NUMBER}\s+total\b`));
  if (after) {
    const value = read(after[1]);
    if (value !== null) return value;
  }

  // "pay sahil 5" — a payment verb, at most two name-shaped words, the number.
  const paid = lower.match(
    new RegExp(String.raw`\b(?:${PAYMENT_VERB})\s+((?:[a-z'’.-]+\s+){0,2})${NUMBER}\b(.*)$`)
  );
  if (paid) {
    const between = paid[1].trim().split(/\s+/).filter(Boolean);
    if (!between.some((word) => NOT_A_NAME_RUN.test(word))) {
      const value = read(paid[2], paid[3]);
      if (value !== null) return value;
    }
  }

  return null;
}

function detectRecipient(text) {
  // The keyword may be capitalised at the start of a sentence, but the name must stay case-sensitive.
  const patterns = [
    /\b[Pp]ay(?:ing)?\s+(?:out\s+)?(?:to\s+)?([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+)?)/u,
    /\b(?:[Tt]o|[Ff]or)\s+([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+)?)\s+(?:when|once|after|if|for|upon)/u,
    // "Chirag will help me…".
    /\b([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+)?)\s+(?:will|shall|should)\s+\p{L}+/u,
    // Lowercase names, where the money does the identifying rather than a capital letter.
    new RegExp(
      String.raw`\b(?:pay(?:ing)?|send|give|owe|transfer|release|settle|will|to)\s+(?:out\s+)?(?:to\s+)?` +
        // "will" is a trigger too, so the name must not swallow the verb that follows it.
        String.raw`(?!(?:pay(?:ing)?|send|give|owe|transfer|release|settle|out|to)\b)` +
        // The second word of a name is never an article either.
        String.raw`([\p{L}][\p{L}'’.-]{1,}(?:\s+(?!a\b|an\b|the\b|of\b|total\b)[\p{L}][\p{L}'’.-]+)?)` +
        // …followed by the money itself, in any of the ways people write it.
        String.raw`\s+(?:${CURRENCY_TOKEN}|\d|(?:a\s+)?total\s+of)`,
      'iu'
    ),
  ];
  for (const pattern of patterns) {
    const found = text.match(pattern);
    const words = nameWords(found?.[1] ?? '');
    if (!words.length) continue;
    if (NOT_A_NAME.has(words[0].toLowerCase())) continue;
    return words.join(' ');
  }

  /** "Chirag will help me in my work. */
  const pronoun = text.match(
    new RegExp(String.raw`\b(?:${PAYMENT_VERB})\s+(?:to\s+)?(?:him|her|them)\b`, 'i')
  );
  if (pronoun) {
    const before = text.slice(0, pronoun.index);
    const candidates = [...before.matchAll(/\b([A-Z][\p{L}'’.-]{1,})\b/gu)]
      .map((match) => match[1])
      .filter((word) => !NOT_A_NAME.has(word.toLowerCase()));
    if (candidates.length) return candidates[candidates.length - 1];
  }
  return null;
}

function detectDeadline(text, today = new Date()) {
  const lower = text.toLowerCase();
  const relative = lower.match(/\b(?:in|within|after)\s+(\d+|a|one|two|three|four|six)\s+(day|week|month)s?\b/);
  if (relative) {
    const raw = relative[1];
    const count = Number.isFinite(Number(raw)) ? Number(raw) : (WORD_NUMBERS[raw] ?? 1);
    const days = relative[2] === 'day' ? count : relative[2] === 'week' ? count * 7 : count * 30;
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return date.toISOString();
  }
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return new Date(`${iso[1]}T17:00:00.000Z`).toISOString();

  const named = lower.match(
    /\bby\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/
  );
  if (named) {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const date = new Date(today.getFullYear(), months.indexOf(named[2]), Number(named[1]), 17);
    if (date < today) date.setFullYear(date.getFullYear() + 1);
    return date.toISOString();
  }
  return null;
}

function classifyCondition(description) {
  for (const signature of CONDITION_SIGNATURES) {
    if (signature.match.test(description)) {
      return {
        type: signature.type,
        verificationMethod: signature.method,
        requiredEvidence: [...signature.evidence],
      };
    }
  }
  return {
    type: CONDITION_TYPE.CUSTOM,
    verificationMethod: VERIFICATION_METHOD.AI_ASSESSMENT,
    requiredEvidence: ['Any artefact that objectively settles this condition'],
  };
}

/** Splits the conditional half of a sentence into independently checkable clauses. */
function splitConditions(text) {
  const trigger = text.match(/\b(when|once|after|if|provided that|upon|as soon as|subject to)\b/i);
  const clauseSource = trigger ? text.slice(trigger.index + trigger[0].length) : text;

  const parts = clauseSource
    .split(/,\s*(?:and\s+)?|\s+and\s+|\s*;\s*|\s+plus\s+|\s+then\s+/i)
    .map((part) =>
      part
        .replace(/^(?:that|he|she|they|it|the)\s+/i, '')
        .replace(/[.!?]+$/, '')
        .trim()
    )
    .filter((part) => part.length > 4 && /[a-z]/i.test(part));

  return unique(parts).slice(0, 10);
}

function findAmbiguities(text) {
  const lower = ` ${text.toLowerCase()} `;
  const flags = [];
  for (const [term, suggestions] of Object.entries(AMBIGUOUS_TERMS)) {
    if (!new RegExp(`[^a-z]${term}[^a-z]`).test(lower)) continue;
    flags.push({
      phrase: term,
      reason: `"${term}" has no artefact that settles it, so the Proof Engine cannot objectively decide when this condition is met.`,
      suggestions: [...suggestions, 'Custom condition'],
    });
  }
  if (/\bwhen (?:the )?work is\b/i.test(text) && !flags.length) {
    flags.push({
      phrase: 'when the work is done',
      reason: 'There is no stated artefact that marks the work as done.',
      suggestions: ['Written client approval', 'Acceptance checklist signed off', 'Delivered files handed over', 'Custom condition'],
    });
  }
  return flags.slice(0, 8);
}

function deriveTitle(text, conditions) {
  const subject = text
    // The payment clause is the price, not the subject.
    .replace(
      new RegExp(
        // The conjunction that joined the work to its price goes with the price.
        String.raw`[,;]?\s*\b(?:so|and|then|after\s+which)?\s*(?:i\s+)?(?:will\s+|shall\s+)?(?:${PAYMENT_VERB})\b[^.;]*$`,
        'i'
      ),
      ''
    )
    .replace(/^.*?\b(?:for|on|to build|to deliver|to design|to write)\b\s*/i, '')
    .replace(/\b(?:when|once|after|if)\b.*$/i, '')
    .replace(/[₹$€£]\s*[\d,.]+\s*(k|lakhs?|crores?)?/gi, '')
    .replace(/\b(?:i'?ll|i will|pay|paying|to)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const strip = (value) =>
    value.replace(/^(?:he|she|they|it|we|i|you|the)\s+/i, '').replace(/^(?:will|shall)\s+/i, '').trim();

  const candidate = strip(subject).split(' ').slice(0, 8).join(' ');
  if (candidate.length > 6) return titleCase(candidate);
  const first = conditions[0]?.description ?? 'Conditional payment';
  return titleCase(strip(first).split(' ').slice(0, 7).join(' '));
}

/* ─────────────────────────── engine surface ─────────────────────────── */

export function parsePromise({ text, defaultCurrency = 'INR', today = new Date() }) {
  const clauses = splitConditions(text);
  const conditions = (clauses.length ? clauses : [text.trim()]).map((description) => ({
    description: titleCase(description).slice(0, 500),
    ...classifyCondition(description),
  }));

  const recipient = detectRecipient(text);
  const outcomeClause = clauses[0] ? titleCase(clauses[0]) : titleCase(text.trim());

  return {
    title: deriveTitle(text, conditions).slice(0, 140),
    amount: detectAmount(text),
    currency: detectCurrency(text, defaultCurrency),
    recipient,
    purpose: conditions[0]?.description?.slice(0, 300) ?? '',
    outcome: outcomeClause.slice(0, 500),
    deadline: detectDeadline(text, today),
    conditions: conditions.slice(0, 12),
    ambiguities: findAmbiguities(text),
  };
}

export function scanAmbiguity({ text, conditions = [] }) {
  const combined = [text, ...conditions.map((condition) => condition.description)].join('. ');
  const ambiguities = findAmbiguities(combined);
  const objective = conditions.filter(
    (condition) => condition.verificationMethod !== VERIFICATION_METHOD.AI_ASSESSMENT
  ).length;
  const base = conditions.length ? 55 + (objective / conditions.length) * 45 : 60;
  return {
    clarityScore: clampScore(base - ambiguities.length * 12),
    ambiguities,
  };
}

export function assessEvidence({ condition, evidence, siblingEvidence = [] }) {
  const conditionTokens = unique([
    ...tokenise(condition.description),
    ...tokenise((condition.requiredEvidence || []).join(' ')),
  ]);
  const evidenceText = [
    evidence.title,
    evidence.note,
    evidence.fileName,
    evidence.url,
    evidence.source,
    evidence.type,
    evidence.extractedText?.slice(0, 4000),
  ]
    .filter(Boolean)
    .join(' ');
  const evidenceTokens = unique(tokenise(evidenceText));

  const overlap = conditionTokens.filter((token) =>
    evidenceTokens.some((other) => other === token || other.includes(token) || token.includes(other))
  );
  const overlapRatio = conditionTokens.length ? overlap.length / conditionTokens.length : 0;

  const preferred = METHOD_PREFERRED_EVIDENCE[condition.verificationMethod] || [];
  const typeFits = preferred.includes(evidence.type);

  const lowerText = neutraliseAbsences(evidenceText.toLowerCase());
  const negatives = NEGATIVE_SIGNALS.filter((signal) => lowerText.includes(signal));
  const contradictedSiblings = siblingEvidence.filter(
    (item) => item.status === 'CONTRADICTED' && String(item.condition) === String(condition._id ?? condition.id)
  );

  // What can actually be inspected.
  const note = evidence.note || '';
  const substantiveNote = note.length >= 60; // an account of what happened, not a label
  const inspectable = Boolean(evidence.fileUrl || evidence.url || evidence.extractedText || substantiveNote);

  let score = 18 + overlapRatio * 55 + (typeFits ? 18 : 0);
  if (evidence.url) score += 6;
  if (evidence.fileUrl) score += 8;
  if (evidence.extractedText) score += 8;
  if (note.length > 40) score += 4;
  if (/\d/.test(note)) score += 6; // counts, dates and references are checkable
  // Without something inspectable this is a claim about proof, not proof itself.
  if (!inspectable) score = Math.min(score, 52);
  score = clampScore(score, 0, 88);

  let verdict = VERDICT.INSUFFICIENT;
  const contradictions = [];
  const missingEvidence = [];

  if (negatives.length) {
    verdict = VERDICT.CONTRADICTS;
    score = clampScore(Math.max(45, score), 0, 82);
    contradictions.push(
      `The submission itself reports a problem ("${negatives[0]}"), which works against this condition being satisfied.`
    );
  } else if (score >= 62 && overlapRatio >= 0.25) {
    verdict = VERDICT.SUPPORTS;
  } else {
    verdict = VERDICT.INSUFFICIENT;
    const stillNeeded = (condition.requiredEvidence || []).filter(
      (requirement) => !tokenise(requirement).some((token) => evidenceTokens.includes(token))
    );
    missingEvidence.push(...(stillNeeded.length ? stillNeeded : ['An artefact that directly demonstrates this condition']));
  }

  if (contradictedSiblings.length) {
    contradictions.push('Proof already on record for this condition was found contradictory.');
  }

  const matched = overlap.slice(0, 4).join(', ');
  const label = evidence.type.replace('_', ' ');

  /** A file whose contents nothing here has seen. */
  const unread = Boolean(evidence.fileUrl) && !evidence.extractedText;

  const insufficient = [
    matched
      ? `This ${label} is related (it shares ${matched}) but does not settle the condition on its own.`
      // Saying "related" when nothing matched claims a connection the score itself denies.
      : `This ${label} shares nothing with what the condition asks for, so it cannot settle it on its own.`,
    unread
      ? `Nothing here reads inside the file — it was judged on the title and note filed with it${
          matched ? '' : ', and there was nothing in them to match'
        }. This is the rule-based engine, which cannot look at a file; re-running the assessment once the Proof Engine's model is reachable, or describing what the file shows, is what would change this reading.`
      : null,
    `Still needed: ${missingEvidence.join('; ')}.`,
  ]
    .filter(Boolean)
    .join(' ');

  const explanation =
    verdict === VERDICT.SUPPORTS
      ? `This ${label} matches the condition on ${matched || 'its stated subject'}${
          typeFits ? ` and is the kind of artefact ${condition.verificationMethod.replace(/_/g, ' ')} expects` : ''
        }. Assessed by rule-based matching, so a person should still eyeball the artefact before fulfilment.`
      : verdict === VERDICT.CONTRADICTS
        ? `This submission conflicts with the condition: ${contradictions[0]}`
        : insufficient;

  return {
    verdict,
    confidence: score,
    explanation,
    contradictions,
    missingEvidence,
  };
}

export function analyseDispute({ promise, conditions, evidence, claims = [], reason = '' }) {
  const byStatus = (status) => conditions.filter((condition) => condition.status === status);
  const verified = byStatus('VERIFIED');
  const failed = byStatus('FAILED');
  const contested = conditions.filter((condition) =>
    ['CONTESTED', 'FAILED', 'VERIFYING'].includes(condition.status)
  );
  const unproven = conditions.filter(
    (condition) => !evidence.some((item) => String(item.condition) === String(condition._id))
  );
  const contradicted = evidence.filter((item) => item.status === 'CONTRADICTED');

  const verifiedRatio = conditions.length ? verified.length / conditions.length : 0;
  let recommendedOutcome = 'needs_more_proof';
  if (verifiedRatio === 1) recommendedOutcome = 'release_full';
  else if (verifiedRatio >= 0.7 && !contradicted.length) recommendedOutcome = 'release_partial';
  else if (failed.length && verifiedRatio < 0.3) recommendedOutcome = 'refund';
  else if (contradicted.length) recommendedOutcome = 'hold';

  const summary = [
    `${verified.length} of ${conditions.length} conditions on ${promise.title} are verified, covering ${Math.round(
      verifiedRatio * 100
    )}% of what the promise requires.`,
    unproven.length ? `${unproven.length} condition(s) have no proof on record at all.` : '',
    contradicted.length ? `${contradicted.length} submitted item(s) contradict the record.` : '',
    claims.length ? `${claims.length} participant statement(s) were filed.` : 'No participant statements were filed.',
  ]
    .filter(Boolean)
    .join(' ');

  const recommendation =
    recommendedOutcome === 'release_full'
      ? 'Every condition is verified. Unless a participant produces new contradicting proof, the payer should authorise fulfilment.'
      : recommendedOutcome === 'release_partial'
        ? 'Most of the promise is proven. Consider releasing against the verified portion and keeping the remainder conditional until the outstanding proof arrives.'
        : recommendedOutcome === 'refund'
          ? 'The record does not show the promised outcome, and at least one condition has failed. A refund to the payer is the reading the record supports.'
          : recommendedOutcome === 'hold'
            ? 'Proof on record conflicts. Money should stay conditional until the conflict is resolved by the participants.'
            : 'The record is too thin to justify moving money in either direction. Request the specific artefacts listed as missing.';

  return {
    summary,
    fulfilledConditions: verified.map((condition) => condition.description),
    contestedConditions: contested.map((condition) => condition.description),
    missingProof: unproven.map(
      (condition) => `${condition.description} — requires ${(condition.requiredEvidence || []).join(', ') || 'any settling artefact'}`
    ),
    contradictions: contradicted.map(
      (item) => `${item.title || item.fileName || item.url || 'A submission'}: ${item.aiExplanation || 'flagged as contradictory'}`
    ),
    recommendation: `${recommendation} A person resolves this contest; this reading is rule-based and advisory.${
      reason ? ` Contest was raised because: ${reason.slice(0, 200)}` : ''
    }`,
    recommendedOutcome,
    confidence: clampScore(45 + verifiedRatio * 35 - contradicted.length * 8),
  };
}

export function explain({ promise, conditions, health, confidence }) {
  const verified = conditions.filter((condition) => condition.status === 'VERIFIED');
  const remaining = conditions.filter((condition) => condition.status !== 'VERIFIED');
  const nextCondition = remaining[0];

  const headline =
    remaining.length === 0
      ? 'Every condition is proven'
      : remaining.length === 1
        ? 'One condition remains unresolved'
        : `${remaining.length} conditions still open`;

  const explanation = [
    `${verified.length} of ${conditions.length} conditions are verified, putting Proof Confidence at ${confidence}% and Promise Health at ${health.overall}%.`,
    nextCondition
      ? `The open item is "${nextCondition.description}", which expects ${
          (nextCondition.requiredEvidence || []).join(' or ') || 'a settling artefact'
        }.`
      : `${promise.amount} ${promise.currency} is ready to move as soon as the payer authorises fulfilment.`,
    health.timeline < 50 && promise.deadline
      ? 'The deadline is close enough that timeline risk is now the largest drag on health.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    headline,
    explanation: explanation.slice(0, 600),
    nextAction: nextCondition
      ? `Submit proof for "${nextCondition.description.slice(0, 90)}".`
      : 'Review the proof, then authorise fulfilment.',
  };
}
