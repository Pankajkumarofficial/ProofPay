import { motion } from 'framer-motion';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';

/**
 * The theme control: light, dark, or follow the system.
 *
 * All three sit on the surface at once rather than hiding behind a cycling
 * button, because "what is it set to now" is the question people actually have
 * — and with a system option, a single icon cannot answer it. A moon on a dark
 * screen is ambiguous: chosen, or inherited?
 */

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

export function ThemeToggle({ className = '' }) {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <div className={className}>
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className="flex border border-ink-300/70 bg-ink-800/60 p-0.5"
      >
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = preference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              // Screen readers get the consequence, not just the label: choosing
              // "System" is what makes the theme follow the machine.
              aria-label={
                value === 'system' ? `System theme (currently ${resolved})` : `${label} theme`
              }
              title={value === 'system' ? `Follow system — currently ${resolved}` : `${label} theme`}
              onClick={() => setPreference(value)}
              // Tight enough that all three labels fit the 15rem rail without clipping.
              className={`relative flex min-w-0 flex-1 items-center justify-center gap-1 px-1.5 py-1.5
                          label transition-colors
                          ${active ? 'text-on-brass' : 'text-paper-400 hover:text-paper-100'}`}
            >
              {active ? (
                <motion.span
                  layoutId="theme-choice"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="absolute inset-0 bg-brass-300"
                />
              ) : null}
              <Icon size={12} strokeWidth={1.8} className="relative z-10 shrink-0" />
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The same choice where there is no room for three targets — a top bar, a
 * crowded header. It cycles, and says out loud what the next press will do,
 * since a lone icon cannot show the other two options.
 */
export function ThemeToggleCompact({ className = '' }) {
  const { preference, resolved, setPreference } = useTheme();
  const index = OPTIONS.findIndex((option) => option.value === preference);
  const current = OPTIONS[index] ?? OPTIONS[2];
  const next = OPTIONS[(index + 1) % OPTIONS.length];
  const { Icon } = current;

  return (
    <button
      type="button"
      onClick={() => setPreference(next.value)}
      aria-label={`Theme: ${current.label}${
        preference === 'system' ? ` (currently ${resolved})` : ''
      }. Switch to ${next.label}.`}
      title={`Theme: ${current.label} — switch to ${next.label}`}
      className={`inline-flex h-9 w-9 items-center justify-center border border-ink-300/70
                  text-paper-300 transition-colors hover:border-paper-400/60 hover:bg-ink-500/50
                  hover:text-paper-50 ${className}`}
    >
      <Icon size={15} strokeWidth={1.6} />
    </button>
  );
}
