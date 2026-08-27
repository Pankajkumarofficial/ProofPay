import { statusMeta, conditionMeta } from '../../utils/status.js';

export function StatusPill({ status, size = 'md', showDot = true, className = '' }) {
  const meta = statusMeta(status);
  const sizing = size === 'sm' ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 border font-mono uppercase tracking-wider ${meta.border} ${meta.bg} ${meta.text} ${sizing} ${className}`}
      title={meta.description}
    >
      {showDot ? <span className={`h-1 w-1 rounded-full ${meta.dot}`} /> : null}
      {meta.label}
    </span>
  );
}

export function ConditionPill({ status, className = '' }) {
  const meta = conditionMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${meta.text} ${className}`}>
      <span className={`h-1 w-1 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
