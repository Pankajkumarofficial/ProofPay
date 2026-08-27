import { forwardRef } from 'react';

function Shell({ label, hint, error, required, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label ? (
        <span className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="eyebrow">
            {label}
            {required ? <span className="ml-1 text-brass-300">*</span> : null}
          </span>
          {hint && !error ? <span className="text-[10px] text-paper-400">{hint}</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="mt-1.5 block text-[11px] text-rust-300">{error}</span> : null}
    </label>
  );
}

export const Input = forwardRef(function Input({ label, hint, error, required, className, ...props }, ref) {
  return (
    <Shell label={label} hint={hint} error={error} required={required} className={className}>
      <input
        ref={ref}
        {...props}
        aria-invalid={Boolean(error)}
        className={`field ${error ? 'border-rust-400/70' : ''}`}
      />
    </Shell>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, hint, error, required, className, rows = 4, ...props },
  ref
) {
  return (
    <Shell label={label} hint={hint} error={error} required={required} className={className}>
      <textarea
        ref={ref}
        rows={rows}
        {...props}
        aria-invalid={Boolean(error)}
        className={`field resize-y leading-relaxed ${error ? 'border-rust-400/70' : ''}`}
      />
    </Shell>
  );
});

export const Select = forwardRef(function Select(
  { label, hint, error, required, className, options = [], children, ...props },
  ref
) {
  return (
    <Shell label={label} hint={hint} error={error} required={required} className={className}>
      <select
        ref={ref}
        {...props}
        aria-invalid={Boolean(error)}
        className={`field cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239A907F' fill='none' stroke-width='1.4'/%3E%3C/svg%3E")] bg-[length:10px] bg-[right_0.9rem_center] bg-no-repeat pr-9 ${
          error ? 'border-rust-400/70' : ''
        }`}
      >
        {children ??
          options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
    </Shell>
  );
});
