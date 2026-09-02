/** ProofPay's visual identity: ink, brass and paper. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      /**
       * Every colour resolves through a CSS variable so the whole palette can be
       * swapped at the :root, rather than every component learning two spellings.
       * The variables hold bare RGB channels, which is what lets Tailwind's
       * opacity modifiers (bg-ink-700/60, border-ink-300/50) keep working.
       *
       * The ramps are roles, not brightnesses: `ink` is the ground the interface
       * sits on, `paper` is the content that sits on it. In the dark theme the
       * ground is dark and the content light; in the light theme both invert, so
       * `ink-800` is always "the page" and `paper-50` always "primary text".
       */
      colors: {
        ink: {
          900: 'rgb(var(--ink-900) / <alpha-value>)', // the deepest ground
          800: 'rgb(var(--ink-800) / <alpha-value>)', // page
          700: 'rgb(var(--ink-700) / <alpha-value>)', // raised surface
          600: 'rgb(var(--ink-600) / <alpha-value>)', // panel
          500: 'rgb(var(--ink-500) / <alpha-value>)', // hover
          400: 'rgb(var(--ink-400) / <alpha-value>)', // hairline strong
          300: 'rgb(var(--ink-300) / <alpha-value>)', // hairline
        },
        paper: {
          50: 'rgb(var(--paper-50) / <alpha-value>)', // primary text
          100: 'rgb(var(--paper-100) / <alpha-value>)',
          200: 'rgb(var(--paper-200) / <alpha-value>)', // secondary text
          300: 'rgb(var(--paper-300) / <alpha-value>)', // muted
          400: 'rgb(var(--paper-400) / <alpha-value>)', // dim
        },
        brass: {
          50: 'rgb(var(--brass-50) / <alpha-value>)',
          100: 'rgb(var(--brass-100) / <alpha-value>)',
          200: 'rgb(var(--brass-200) / <alpha-value>)',
          300: 'rgb(var(--brass-300) / <alpha-value>)', // primary accent
          400: 'rgb(var(--brass-400) / <alpha-value>)',
          500: 'rgb(var(--brass-500) / <alpha-value>)',
          600: 'rgb(var(--brass-600) / <alpha-value>)',
        },
        sage: {
          300: 'rgb(var(--sage-300) / <alpha-value>)',
          400: 'rgb(var(--sage-400) / <alpha-value>)',
          500: 'rgb(var(--sage-500) / <alpha-value>)',
        },
        rust: {
          300: 'rgb(var(--rust-300) / <alpha-value>)',
          400: 'rgb(var(--rust-400) / <alpha-value>)',
          500: 'rgb(var(--rust-500) / <alpha-value>)',
        },
        ochre: {
          300: 'rgb(var(--ochre-300) / <alpha-value>)',
          400: 'rgb(var(--ochre-400) / <alpha-value>)',
        },
        slate: {
          300: 'rgb(var(--slate-300) / <alpha-value>)',
          400: 'rgb(var(--slate-400) / <alpha-value>)',
        },

        /**
         * Two roles that must NOT follow the ground when the theme flips.
         *
         * `on-brass` is whatever stays readable printed on the brass accent — a
         * primary button, a count badge. It tracks the accent, not the page, so
         * flipping the ground must not turn it into pale-on-gold.
         *
         * `scrim` is the veil behind a modal. A dialog is lifted out of the page
         * in both themes, so the thing it is lifted out of is dimmed in both.
         */
        'on-brass': 'rgb(var(--on-brass) / <alpha-value>)',
        scrim: 'rgb(var(--scrim) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        widest: '0.24em',
        wider: '0.14em',
      },
      boxShadow: {
        // A dark theme lifts a panel with a pool of black; a light one cannot, so
        // the depth and the inset highlight both come from variables.
        panel: 'var(--edge-inset), 0 24px 60px -30px rgb(var(--shadow) / var(--shadow-soft))',
        lift: '0 30px 70px -40px rgb(var(--shadow) / var(--shadow-strong))',
        seal: '0 0 0 1px rgb(var(--brass-300) / 0.22), 0 0 40px -12px rgb(var(--brass-300) / 0.35)',
      },
      backgroundImage: {
        grain:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E\")",
      },
      keyframes: {
        'seal-in': {
          '0%': { opacity: '0', transform: 'scale(0.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        'pulse-ring': {
          '0%': { opacity: '0.55', transform: 'scale(1)' },
          '70%': { opacity: '0', transform: 'scale(1.5)' },
          '100%': { opacity: '0', transform: 'scale(1.5)' },
        },
      },
      animation: {
        'seal-in': 'seal-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        sweep: 'sweep 1.7s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};
