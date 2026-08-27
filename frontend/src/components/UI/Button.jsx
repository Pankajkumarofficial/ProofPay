import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  quiet: 'btn-quiet',
  danger: 'btn-danger',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-[10px]',
  md: 'px-4 py-2.5 text-[11px]',
  lg: 'px-6 py-3 text-[12px]',
};

export const Button = forwardRef(function Button(
  { variant = 'ghost', size = 'md', loading = false, icon: Icon, children, className = '', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      {...props}
      disabled={props.disabled || loading}
      className={`${VARIANTS[variant] ?? VARIANTS.ghost} ${SIZES[size]} ${className}`}
    >
      {loading ? (
        <Loader2 size={13} className="animate-spin" strokeWidth={2} />
      ) : Icon ? (
        <Icon size={13} strokeWidth={1.75} />
      ) : null}
      {children}
    </button>
  );
});
