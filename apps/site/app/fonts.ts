import localFont from 'next/font/local';

/**
 * Cairo 700, the heading face (h1–h3 and `font-display`), one face per subset as in @fontsource/cairo. Loaded through
 * next/font so the files are self-hosted under /_next/static/media (CSP font-src 'self') and the Arabic and Latin
 * subsets are preloaded in <head>. `display: optional` means a face is used only if it is ready at first render, so
 * its arrival never reflows headings (Lighthouse CLS); on a slow first visit headings stay in IBM Plex Sans Arabic 700
 * and Cairo is used from the cache on later pages. The rare latin-ext subset is not preloaded.
 */
export const cairoArabic = localFont({
  src: [{ path: '../node_modules/@fontsource/cairo/files/cairo-arabic-700-normal.woff2', weight: '700', style: 'normal' }],
  display: 'optional',
  preload: true,
  adjustFontFallback: false,
  variable: '--font-cairo-arabic',
  declarations: [{ prop: 'unicode-range', value: 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1' }],
});

export const cairoLatin = localFont({
  src: [{ path: '../node_modules/@fontsource/cairo/files/cairo-latin-700-normal.woff2', weight: '700', style: 'normal' }],
  display: 'optional',
  preload: true,
  adjustFontFallback: false,
  variable: '--font-cairo-latin',
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' }],
});

export const cairoLatinExt = localFont({
  src: [{ path: '../node_modules/@fontsource/cairo/files/cairo-latin-ext-700-normal.woff2', weight: '700', style: 'normal' }],
  display: 'optional',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-cairo-latin-ext',
  declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' }],
});

/**
 * IBM Plex Sans Arabic, the body face (400/500/700), handled like the heading face: self-hosted through next/font,
 * the Arabic faces preloaded, and `display: optional`, so body text paints at once and is never redrawn when the font
 * arrives. Text that waited for a swapped web font was the largest paint on phone layouts (e.g. the doctor filters)
 * and delayed it on slow connections; on a slow first visit the system Arabic font is used for that page instead.
 */
export const plexArabic = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  display: 'optional',
  preload: true,
  adjustFontFallback: false,
  variable: '--font-plex-arabic',
  declarations: [{ prop: 'unicode-range', value: 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1' }],
});

export const plexLatin = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  display: 'optional',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-plex-latin',
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' }],
});

/** Class names that define the --font-* variables; set on <html>. */
export const headingFontVariables = [cairoArabic.variable, cairoLatin.variable, cairoLatinExt.variable, plexArabic.variable, plexLatin.variable].join(' ');
