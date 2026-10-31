/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { ink: '#20302b', muted: '#68776e', canvas: '#f6f7f2', leaf: '#3b775e', mint: '#e5f1e8', sand: '#f3ecdc', coral: '#bc715b' }, boxShadow: { soft: '0 12px 36px rgba(34, 53, 43, .07)' } } },
  plugins: [],
};
