/**
 * R1 gate UI checks (SRS §11.8): axe (WCAG 2.1 A/AA, no serious/critical violations) in Arabic and English,
 * RTL/LTR direction and no horizontal overflow at desktop (1366×768, NFR-6) and phone width, an RTL screenshot suite,
 * and Lighthouse performance/accessibility on mobile for the public site (target ≥ 90).
 *
 * Env: SITE_URL (default http://localhost:3000), CONSOLE_URL (default http://localhost:3001, dev login),
 *      CHROMIUM_PATH, OUT (screenshots/report dir), LIGHTHOUSE=0 to skip, DOCTOR_SLUG (default ahmed-samy).
 * Exit code 1 when any check fails. Writes OUT/report.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

/** Load a page, then give it up to 8 s to settle. Some pages never go network-idle (map tiles, live queue streams). */
async function open(page, url) {
  const res = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return res;
}

const SITE = process.env.SITE_URL ?? 'http://localhost:3000';
const CONSOLE = process.env.CONSOLE_URL ?? 'http://localhost:3001';
const OUT = process.env.OUT ?? 'ui-report';
const SLUG = process.env.DOCTOR_SLUG ?? 'ahmed-samy';
const executablePath = process.env.CHROMIUM_PATH || undefined;
mkdirSync(OUT, { recursive: true });

const sitePages = ['', '/doctors', `/doctors/${SLUG}`, '/clinics', '/services', '/book', '/portal/sign-in', '/verify/rx', '/privacy'];
const consolePages = ['/dashboard', '/reception', '/calendar', '/patients', '/cashier', '/doctor', '/manager/schedules', '/admin/privileges'];
const viewports = { desktop: { width: 1366, height: 768 }, phone: { width: 390, height: 844 } };

const results = [];
const failures = [];

async function check(page, { app, path, locale, viewport }) {
  const name = `${app}_${locale}_${viewport}${path.replace(/[^a-z0-9]+/gi, '_') || '_home'}`;
  const r = { name, app, path, locale, viewport, violations: [], dir: null, overflow: false };
  await page.waitForTimeout(400);
  r.dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  if (r.dir !== (locale === 'ar' ? 'rtl' : 'ltr')) failures.push(`${name}: dir=${r.dir}`);
  r.overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (r.overflow) failures.push(`${name}: horizontal overflow`);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  r.violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  for (const v of r.violations) if (v.impact === 'serious' || v.impact === 'critical') failures.push(`${name}: axe ${v.impact} ${v.id} (${v.nodes}) ${v.targets.join(' | ')}`);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  results.push(r);
}

const browser = await chromium.launch({ executablePath });
try {
  // Public site
  for (const [vp, size] of Object.entries(viewports)) {
    const ctx = await browser.newContext({ viewport: size });
    const page = await ctx.newPage();
    for (const locale of ['ar', 'en']) {
      for (const p of sitePages) {
        const res = await open(page, `${SITE}/${locale}${p}`);
        if (!res || res.status() >= 400) failures.push(`site ${locale}${p}: HTTP ${res?.status()}`);
        await check(page, { app: 'site', path: p, locale, viewport: vp });
      }
    }
    await ctx.close();
  }
  // Staff console (dev login), desktop only - reception PCs (NFR-6)
  const ctx = await browser.newContext({ viewport: viewports.desktop });
  const page = await ctx.newPage();
  await open(page, `${CONSOLE}/login`);
  await page.selectOption('#dev-user', 'owner@demo.healthflow.eg');
  await page.locator('form button').last().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  for (const locale of ['ar', 'en']) {
    await ctx.addCookies([{ name: 'hf_locale', value: locale, url: CONSOLE }]);
    for (const p of consolePages) {
      const res = await open(page, `${CONSOLE}${p}`);
      if (!res || res.status() >= 400) failures.push(`console ${p}: HTTP ${res?.status()}`);
      await check(page, { app: 'console', path: p, locale, viewport: 'desktop' });
    }
  }
  await ctx.close();
} finally {
  await browser.close();
}

// Lighthouse (mobile emulation) for the main public pages
const lighthouseScores = [];
if (process.env.LIGHTHOUSE !== '0') {
  const { default: lighthouse } = await import('lighthouse');
  const { launch } = await import('chrome-launcher');
  const chrome = await launch({ chromePath: executablePath, chromeFlags: ['--headless=new', '--no-sandbox'] });
  try {
    for (const p of ['/ar', '/ar/doctors', `/ar/doctors/${SLUG}`]) {
      // Median of three runs per page, as Lighthouse recommends: single runs vary a lot on shared CI runners.
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(await lighthouse(`${SITE}${p}`, { port: chrome.port, output: 'json', onlyCategories: ['performance', 'accessibility', 'seo', 'best-practices'], logLevel: 'error' }));
      runs.sort((x, y) => x.lhr.categories.performance.score - y.lhr.categories.performance.score);
      const r = runs[1];
      const c = r.lhr.categories;
      const s = { path: p, performance: Math.round(c.performance.score * 100), accessibility: Math.round(c.accessibility.score * 100), seo: Math.round(c.seo.score * 100), bestPractices: Math.round(c['best-practices'].score * 100), lcpMs: Math.round(r.lhr.audits['largest-contentful-paint'].numericValue) };
      lighthouseScores.push(s);
      if (s.accessibility < 90) failures.push(`lighthouse ${p}: accessibility ${s.accessibility}`);
      if (s.performance < 90) {
        failures.push(`lighthouse ${p}: performance ${s.performance} (target 90; measure on staging/Vercel, local servers are not representative)`);
        // Diagnostics in the CI log: every run's score and the median run's slowest parts.
        const a = r.lhr.audits;
        const lcpEl = a['largest-contentful-paint-element']?.details?.items?.flatMap((g) => g.items ?? []).find((x) => x.node)?.node;
        console.log(`[lighthouse ${p}] runs ${runs.map((x) => Math.round(x.lhr.categories.performance.score * 100)).join('/')}; ` +
          ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'].map((k) => `${k}=${a[k]?.displayValue}`).join(', ') +
          `; LCP element ${lcpEl?.selector ?? '?'} "${(lcpEl?.nodeLabel ?? '').slice(0, 60)}"`);
        for (const k of ['largest-contentful-paint-element', 'render-blocking-resources', 'bootup-time', 'unused-javascript', 'server-response-time', 'font-display', 'uses-rel-preconnect'])
          if (a[k] && a[k].score !== null && a[k].score < 0.9) console.log(`  ${k}: ${a[k].displayValue ?? ''} ${JSON.stringify((a[k].details?.items ?? []).flatMap((g) => g.items ?? [g]).slice(0, 4).map((x) => x.phase ? `${x.phase} ${Math.round(x.timing)}ms` : `${(x.url ?? '').slice(-50)} ${Math.round(x.wastedMs ?? x.total ?? 0)}ms`))}`);
      }
    }
  } finally {
    await chrome.kill();
  }
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), pages: results.length, failures, lighthouse: lighthouseScores, results }, null, 2));
console.log(`checked ${results.length} page views; lighthouse ${JSON.stringify(lighthouseScores)}`);
if (failures.length) {
  console.log(`\n${failures.length} failure(s):\n` + failures.join('\n'));
  process.exit(1);
}
console.log('UI quality gate passed');
