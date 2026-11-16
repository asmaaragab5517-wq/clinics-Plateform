/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@hf/ui/tailwind-preset')],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}', '../../packages/ui/src/**/*.tsx'],
  theme: { extend: {} },
  plugins: [],
};
