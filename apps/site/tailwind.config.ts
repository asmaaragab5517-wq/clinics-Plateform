import type { Config } from 'tailwindcss';
import preset from '@hf/ui/tailwind-preset';

const config: Config = {
  presets: [preset],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}', '../../packages/ui/src/**/*.tsx'],
  // Cairo 700 comes from next/font (app/fonts.ts) under generated family names; keep in step with globals.css h1–h3.
  theme: { extend: { fontFamily: { display: ['var(--font-cairo-arabic)', 'var(--font-cairo-latin)', 'var(--font-cairo-latin-ext)', '"IBM Plex Sans Arabic"', 'sans-serif'] } } },
};

export default config;
