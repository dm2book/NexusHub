import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#06060c',
        elevated: '#0e0e18',
        card: '#13131f',
        primary: '#6366f1',
        secondary: '#8b5cf6',
        accent: '#ec4899',
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        tech: ['Rajdhani', 'sans-serif'],
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-16px)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulseRing: { '0%': { transform: 'scale(.9)', opacity: '.7' }, '100%': { transform: 'scale(1.7)', opacity: '0' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        'float-slow': 'float 11s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        'pulse-ring': 'pulseRing 2.4s cubic-bezier(.4,0,.6,1) infinite',
        marquee: 'marquee 32s linear infinite',
      },
      boxShadow: {
        neon: '0 0 36px rgba(99,102,241,.45)',
        'neon-lg': '0 0 70px rgba(168,85,247,.5)',
      },
    },
  },
  plugins: [],
};
export default config;
