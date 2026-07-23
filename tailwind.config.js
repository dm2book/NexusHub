/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'space-black': '#070710',
        'elevated': '#101019',
        'card-bg': '#15151f',
        'primary': '#6366f1',
        'secondary': '#8b5cf6',
        'accent-blue': '#3b82f6',
        'accent-purple': '#a855f7',
        'accent-pink': '#ec4899',
        'accent-cyan': '#22d3ee',
      },
      fontFamily: {
        'display': ['Bricolage Grotesque', 'Inter', 'sans-serif'],
        'grotesk': ['Bricolage Grotesque', 'Inter', 'sans-serif'],
        'orbitron': ['Bricolage Grotesque', 'Inter', 'sans-serif'], // legacy alias → new display font
        'inter': ['Inter', 'sans-serif'],
        'rajdhani': ['Rajdhani', 'sans-serif'],
      },
      animation: {
        'fade-up': 'fadeUp 0.5s ease-out forwards',
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'glow-pulse': 'glowPulse 3s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'float-slow': 'float 9s ease-in-out infinite',
        'shimmer': 'shimmer 2.2s linear infinite',
        'gradient': 'gradientShift 8s ease infinite',
        'spin-slow': 'spin 18s linear infinite',
        'marquee': 'marquee 30s linear infinite',
        'pulse-ring': 'pulseRing 2.5s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 24px rgba(99, 102, 241, 0.35)' },
          '50%': { boxShadow: '0 0 48px rgba(168, 85, 247, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-18px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'grid-pattern': 'linear-gradient(rgba(99,102,241,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,.06) 1px, transparent 1px)',
      },
      boxShadow: {
        'neon': '0 0 30px rgba(99,102,241,.45)',
        'neon-lg': '0 0 60px rgba(168,85,247,.5)',
      },
    },
  },
  plugins: [],
}
