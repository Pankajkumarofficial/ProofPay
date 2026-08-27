import { Cpu, CircuitBoard } from 'lucide-react';

/** How each provider names itself, so the badge reads the way people say it. */
const PROVIDERS = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  gemini: 'Gemini',
};

/**
 * Says which engine produced a judgement. ProofPay never implies a model read
 * something it did not: when no model is configured — or one failed and the
 * deterministic engine answered instead — that is what the badge names.
 */
export function EngineBadge({ engine, model, className = '' }) {
  const vendor = PROVIDERS[engine];
  const Icon = vendor ? Cpu : CircuitBoard;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-paper-400 ${className}`}
      title={
        vendor
          ? `Assessed by ${model ?? vendor} and validated against ProofPay's schema before storage.`
          : 'Assessed by ProofPay’s deterministic engine — rule-based matching, no model call.'
      }
    >
      <Icon size={10} strokeWidth={1.75} />
      {vendor ? (model ?? vendor) : 'local engine'}
    </span>
  );
}
