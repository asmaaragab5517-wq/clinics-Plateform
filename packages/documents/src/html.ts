import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export { esc };

function font(pkg: string, file: string): string {
  try {
    const dir = dirname(require.resolve(`${pkg}/package.json`));
    return readFileSync(join(dir, 'files', file)).toString('base64');
  } catch {
    return '';
  }
}

let fontCss: string | null = null;
/** Self-hosted fonts embedded in the PDF (LOC-3): IBM Plex Sans Arabic for text, Amiri for headings. */
export function fontFaces(): string {
  if (fontCss !== null) return fontCss;
  const faces: [string, string, string, number][] = [
    ['Plex', '@fontsource/ibm-plex-sans-arabic', 'ibm-plex-sans-arabic-arabic-400-normal.woff2', 400],
    ['Plex', '@fontsource/ibm-plex-sans-arabic', 'ibm-plex-sans-arabic-arabic-700-normal.woff2', 700],
    ['Plex', '@fontsource/ibm-plex-sans-arabic', 'ibm-plex-sans-arabic-latin-400-normal.woff2', 400],
    ['Plex', '@fontsource/ibm-plex-sans-arabic', 'ibm-plex-sans-arabic-latin-700-normal.woff2', 700],
    ['Amiri', '@fontsource/amiri', 'amiri-arabic-700-normal.woff2', 700],
  ];
  fontCss = faces
    .map(([family, pkg, file, weight]) => {
      const b64 = font(pkg, file);
      return b64 ? `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}` : '';
    })
    .join('\n');
  return fontCss;
}

export function page(opts: { title: string; size: 'A4' | 'A5'; body: string; dir?: 'rtl' | 'ltr'; watermark?: string }): string {
  return `<!doctype html><html lang="${opts.dir === 'ltr' ? 'en' : 'ar'}" dir="${opts.dir ?? 'rtl'}"><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
${fontCss ?? fontFaces()}
@page { size: ${opts.size}; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: 'Plex', 'Noto Naskh Arabic', sans-serif; color: #111; font-size: ${opts.size === 'A5' ? '10.5pt' : '11pt'}; margin: 0; }
h1, h2 { font-family: 'Amiri', 'Plex', serif; margin: 0; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-block-end: 2px solid #0f766e; padding-block-end: 6px; margin-block-end: 10px; }
.muted { color: #555; font-size: 0.85em; }
.row { display: flex; justify-content: space-between; gap: 12px; }
table { width: 100%; border-collapse: collapse; margin-block: 8px; }
th, td { border-block-end: 1px solid #ddd; padding: 4px 6px; text-align: start; vertical-align: top; }
th { background: #f0fdfa; }
.num { text-align: end; font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.totals td { border: none; }
.footer { position: fixed; inset-block-end: 0; inset-inline: 0; font-size: 8pt; color: #666; border-block-start: 1px solid #ddd; padding-block-start: 4px; }
.sig { display: flex; gap: 16px; align-items: flex-end; margin-block-start: 16px; }
.sig img { max-height: 60px; }
.watermark { position: fixed; inset-block-start: 45%; inset-inline: 0; text-align: center; opacity: .08; font-size: 28pt; transform: rotate(-20deg); }
.rx-line { padding-block: 6px; border-block-end: 1px dashed #ccc; }
.rx-line b { font-size: 1.05em; }
</style></head><body>${opts.watermark ? `<div class="watermark">${esc(opts.watermark)}</div>` : ''}${opts.body}</body></html>`;
}
