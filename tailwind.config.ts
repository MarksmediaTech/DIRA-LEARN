import type { Config } from 'tailwindcss';

// DIRA LEARN design tokens. Purple leads, orange is reserved for the one thing that needs attention.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#21173A',
        purple: { 50: '#F6F2FC', 100: '#E9DFF7', 200: '#D2BFEF', 500: '#7B4FC9', 600: '#6537B3', 700: '#4F2A8F', 900: '#2D1A54' },
        orange: { 50: '#FFF3E6', 500: '#F58220', 600: '#D96C0E' },
        // Palette (deep = the website's theme colour #1E0B3D): deep > primary > royal purple, lavender, soft gold. orange and logo are sampled from the official DIRA Foundation logo (#FE7613, #4C1D95).
        dira: { deep: '#1E0B3D', primary: '#452064', royal: '#61358A', lavender: '#E9DDF3', gold: '#D6B66F', orange: '#FE7613', logo: '#4C1D95' },
        ok: '#1F7A4D', warn: '#B45309', danger: '#B3261E',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Figtree', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // reactions use the device's colour emoji font (Apple, Windows and Android all ship one)
        emoji: ['"Apple Color Emoji"', '"Segoe UI Emoji"', '"Noto Color Emoji"', '"Segoe UI Symbol"', 'sans-serif'],
      },
      keyframes: {
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        kenburns: { '0%': { transform: 'scale(1) translate3d(0,0,0)' }, '100%': { transform: 'scale(1.1) translate3d(-1.5%,-1%,0)' } },
        'rise-in': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        // notification bell: a short swing when something new arrives; toasts slide in from the right
        ring: { '0%, 100%': { transform: 'rotate(0)' }, '20%': { transform: 'rotate(14deg)' }, '40%': { transform: 'rotate(-12deg)' }, '60%': { transform: 'rotate(8deg)' }, '80%': { transform: 'rotate(-4deg)' } },
        'toast-in': { from: { opacity: '0', transform: 'translateX(24px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
      },
      animation: { kenburns: 'kenburns 18s ease-in-out infinite alternate', float: 'float 7s ease-in-out infinite', 'rise-in': 'rise-in 0.7s ease-out both', ring: 'ring 0.9s ease-in-out 1', 'toast-in': 'toast-in 0.25s ease-out both' },
      borderRadius: { card: '14px', control: '8px' },
    },
  },
  plugins: [],
} satisfies Config;
