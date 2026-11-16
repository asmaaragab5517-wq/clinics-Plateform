import type { Browser } from 'playwright-core';
import QRCode from 'qrcode';

let browserPromise: Promise<Browser> | null = null;

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    const { chromium } = await import('playwright-core');
    browserPromise = chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
  }
  return browserPromise;
}

/**
 * Render HTML to PDF with headless Chromium. Network access is blocked during rendering so templates
 * cannot fetch remote resources (all fonts and images are embedded as data URLs).
 */
export async function renderPdf(html: string, opts: { size?: 'A4' | 'A5' } = {}): Promise<Buffer> {
  const b = await browser();
  const ctx = await b.newContext({ javaScriptEnabled: false });
  try {
    await ctx.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: opts.size ?? 'A4', printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    await ctx.close();
  }
}

export async function closeRenderer() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
}
