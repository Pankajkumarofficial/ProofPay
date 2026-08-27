/** ProofPay's visual identity: ink, brass and paper. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0A0908', // the deepest ground
          800: '#100E0C', // page
          700: '#161311', // raised surface
          600: '#1D1916', // panel
          500: '#262019', // hover
          400: '#2F2822', // hairline strong
          300: '#3A322A', // hairline
        },
        paper: {
          50: '#F6F1E7', // primary text
          100: '#E7DFD1',
          200: '#C9BEAC', // secondary text
          300: '#9A907F', // muted
          400: '#6F675A', // dim
        },
        brass: {
          50: '#FBEFD5',
          100: '#F0D8A4',
          200: '#E3BE7F',
          300: '#D9A441', // primary accent
          400: '#B9862C',
          500: '#8E651F',
          600: '#5C4214',
        },
        sage: { 300: '#93B183', 400: '#7E9B6E', 500: '#5C7550' },
        rust: { 300: '#D07A5E', 400: '#B4593F', 500: '#8A3F2A' },
        ochre: { 300: '#DCA95C', 400: '#C08A3E' },
        slate: { 300: '#8B9296', 400: '#6E7B7F' },
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
        panel: '0 1px 0 0 rgba(246,241,231,0.03) inset, 0 24px 60px -30px rgba(0,0,0,0.9)',
        lift: '0 30px 70px -40px rgba(0,0,0,0.95)',
        seal: '0 0 0 1px rgba(217,164,65,0.22), 0 0 40px -12px rgba(217,164,65,0.35)',
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
