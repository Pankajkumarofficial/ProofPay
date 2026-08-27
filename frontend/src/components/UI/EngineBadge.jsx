import { Cpu, CircuitBoard } from 'lucide-react';

/**
 * Says which engine produced a judgement. ProofPay never implies a model read
 * something it did not: when Claude is not configured, the deterministic engine
 * is named, on every assessment it produces.
 */
export function EngineBadge({ engine, model, className = '' }) {
  const isClaude = engine === 'claude';
  const Icon = isClaude ? Cpu : CircuitBoard;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-paper-400 ${className}`}
      title={
        isClaude
          ? `Assessed by ${model ?? 'Claude'} and validated against ProofPay's schema before storage.`
          : 'Assessed by ProofPay’s deterministic engine — rule-based matching, no model call.'
      }
    >
      <Icon size={10} strokeWidth={1.75} />
      {isClaude ? (model ?? 'claude') : 'local engine'}
    </span>
  );
}
