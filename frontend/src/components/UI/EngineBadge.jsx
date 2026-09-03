import { Cpu, CircuitBoard } from 'lucide-react';

/** How each vendor names itself, so the badge reads the way people say it. */
const PROVIDERS = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  gemini: 'Gemini',
};

/** What the backend records when no model answered. */
const LOCAL_ENGINE = 'local-engine';

/**
 * Who answered, in the form the interface should say it.
 *
 * Three cases, and the third is the one that is easy to get wrong. A vendor
 * names itself. The deterministic engine names itself. Anything else is a
 * gateway host — a reseller speaking a vendor's wire format — and it must be
 * named as the host, because that is the whole of what ProofPay can verify
 * about who produced the reading.
 *
 * Returning `null` for anything unrecognised is what this used to do, and it
 * meant a reading from a gateway was displayed as *"local engine"* — the same
 * misattribution as claiming a vendor, pointing the other way.
 */
function describeEngine(engine, model) {
  if (!engine || engine === LOCAL_ENGINE) return null;
  const vendor = PROVIDERS[engine];
  if (vendor) return { name: model ?? vendor, host: null };
  return { name: model ?? engine, host: engine };
}

/**
 * The same attribution as the badge, as a phrase, for sentences that carry a
 * verdict where a badge cannot go — a toast, a notification body.
 */
export const engineLabel = (engine, model) => {
  const described = describeEngine(engine, model);
  return described ? described.name : 'the local engine';
};

/**
 * Says which engine produced a judgement. ProofPay never implies a model read
 * something it did not: when no model is configured — or one failed and the
 * deterministic engine answered instead — that is what the badge names.
 */
export function EngineBadge({ engine, model, className = '' }) {
  const described = describeEngine(engine, model);
  const Icon = described ? Cpu : CircuitBoard;

  const title = !described
    ? 'Assessed by ProofPay’s deterministic engine — rule-based matching, no model call.'
    : described.host
      ? // Named as reached, not as claimed: the gateway says which model served
        // the request, and that claim is worth exactly as much as the gateway is.
        `Assessed by ${described.name} via ${described.host}, and validated against ProofPay's schema before storage.`
      : `Assessed by ${described.name} and validated against ProofPay's schema before storage.`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 label text-paper-400 ${className}`}
      title={title}
    >
      <Icon size={10} strokeWidth={1.75} />
      {described ? described.name : 'local engine'}
    </span>
  );
}
