import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#06060a',
          800: '#0a0a12',
          700: '#0f0f1a',
          600: '#15151f',
          500: '#1c1c2b',
        },
        brand: {
          DEFAULT: '#8b5cf6',
          300: '#a78bfa',
          400: '#8b5cf6',
          500: '#7c3aed',
          600: '#6d28d9',
        },
        accent: { DEFAULT: '#22d3ee', cyan: '#22d3ee', emerald: '#10b981', gold: '#f59e0b' },
        up: '#10b981',
        down: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Sora', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(139, 92, 246, 0.35)',
        'glow-cyan': '0 0 24px rgba(34, 211, 238, 0.3)',
        card: '0 8px 32px rgba(0, 0, 0, 0.4)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
        'brand-gradient': 'linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%)',
      },
      animation: {
        'fade-up': 'fadeUp 0.4s ease-out forwards',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulseGlow: { '0%,100%': { boxShadow: '0 0 16px rgba(139,92,246,0.25)' }, '50%': { boxShadow: '0 0 32px rgba(139,92,246,0.6)' } },
      },
    },
  },
  plugins: [],
};

export default config;
