/** HealthFlow RTL design system preset (LOC-2, LOC-3). Colours are CSS variables so clinics can brand them. */
module.exports = {
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--hf-bg) / <alpha-value>)',
        surface: 'rgb(var(--hf-surface) / <alpha-value>)',
        fg: 'rgb(var(--hf-fg) / <alpha-value>)',
        muted: 'rgb(var(--hf-muted) / <alpha-value>)',
        border: 'rgb(var(--hf-border) / <alpha-value>)',
        primary: { DEFAULT: 'rgb(var(--hf-primary) / <alpha-value>)', fg: 'rgb(var(--hf-primary-fg) / <alpha-value>)' },
        accent: 'rgb(var(--hf-accent) / <alpha-value>)',
        danger: 'rgb(var(--hf-danger) / <alpha-value>)',
        warning: 'rgb(var(--hf-warning) / <alpha-value>)',
        success: 'rgb(var(--hf-success) / <alpha-value>)',
      },
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'], display: ['Cairo', '"IBM Plex Sans Arabic"', 'sans-serif'] },
      borderRadius: { xl: '0.875rem' },
    },
  },
  plugins: [],
};
