/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#06060a',
          900: '#0a0a11',
          850: '#0e0e17',
          800: '#12121c',
          700: '#1a1a28',
          600: '#252538',
          500: '#34344d',
        },
        fg: { DEFAULT: '#ececf4', muted: '#a3a3ba', faint: '#6c6c86' },
        // Theme-driven accent (see styles/index.css)
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        ember: '#e23b4e',
        azure: '#3ea6ff',
        violet: '#8b5cf6',
        jade: '#34d399',
        amber: '#f5b041',
      },
      fontFamily: {
        display: ['"Chakra Petch"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 0 36px -10px rgb(var(--accent) / 0.55)',
        panel: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 24px 48px -28px rgb(0 0 0 / 0.9)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
        'spin-slow': 'spin-slow 40s linear infinite',
        'spin-slower': 'spin-slow 70s linear infinite reverse',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
