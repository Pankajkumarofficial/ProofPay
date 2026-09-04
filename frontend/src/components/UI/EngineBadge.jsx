import { Cpu, CircuitBoard } from 'lucide-react';

/** How each vendor names itself, so the badge reads the way people say it. */
const PROVIDERS = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  gemini: 'Gemini',
};

/** What the backend records when no model answered. */
const LOCAL_ENGINE = 'local-engine';

/** Who answered, in the form the interface should say it. */
function describeEngine(engine, model) {
  if (!engine || engine === LOCAL_ENGINE) return null;
  const vendor = PROVIDERS[engine];
  if (vendor) return { name: model ?? vendor, host: null };
  return { name: model ?? engine, host: engine };
}

/** The same attribution as the badge. */
export const engineLabel = (engine, model) => {
  const described = describeEngine(engine, model);
  return described ? described.name : 'the local engine';
};

/** Says which engine produced a judgement. */
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
