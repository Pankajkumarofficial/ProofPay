/** The product's structural unit: a ruled panel with an engraved header. */
export function Panel({ title, eyebrow, action, children, className = '', bodyClass = 'p-5' }) {
  return (
    <section className={`panel engraved ${className}`}>
      {(title || eyebrow || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-ink-300/60 px-5 py-3.5">
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? (
              <h2 className="mt-1 font-display text-[17px] font-normal leading-tight text-paper-50">{title}</h2>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** A labelled figure. The value is always passed in from API data. */
export function Stat({ label, value, sub, tone = 'default', className = '' }) {
  const tones = {
    default: 'text-paper-50',
    brass: 'text-brass-200',
    sage: 'text-sage-300',
    rust: 'text-rust-300',
    ochre: 'text-ochre-300',
    muted: 'text-paper-300',
  };
  return (
    <div className={className}>
      <p className="eyebrow">{label}</p>
      <p className={`tnum mt-2 font-display text-[26px] leading-none ${tones[tone] ?? tones.default}`}>{value}</p>
      {sub ? <p className="mt-1.5 text-[11px] leading-snug text-paper-400">{sub}</p> : null}
    </div>
  );
}
