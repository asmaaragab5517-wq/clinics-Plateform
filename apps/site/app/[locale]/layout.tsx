import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/cairo/700.css';
import '@hf/ui/styles.css';
import '../globals.css';
import type { Metadata, Viewport } from 'next';
import { SiteFooter } from '@/components/site/Footer';
import { SiteHeader } from '@/components/site/Header';
import { JsonLd } from '@/components/site/JsonLd';
import { ServiceWorker } from '@/components/site/ServiceWorker';
import { SITE_URL } from '@/lib/config';
import { asLocale, dir, t, type Locale } from '@/lib/i18n';
import { alternates, localeUrl } from '@/lib/seo';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t(locale, 'home.metaTitle'), template: `%s | ${t(locale, 'app.name')}` },
    description: t(locale, 'site.description'),
    applicationName: t(locale, 'app.name'),
    alternates: alternates(locale, ''),
    formatDetection: { telephone: false },
    // PWA (BRD risk table: offline-tolerant): Arabic, RTL manifest; see public/sw.js for what is cached.
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/icons/icon.svg', type: 'image/svg+xml' },
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      ],
      apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
    },
    appleWebApp: { capable: true, title: t(locale, 'app.name'), statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f766e' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

function orgLd(locale: Locale) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalOrganization',
    name: t(locale, 'app.name'),
    url: localeUrl(locale),
    inLanguage: locale,
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const locale = asLocale((await params).locale);
  return (
    <html lang={locale === 'ar' ? 'ar-EG' : 'en'} dir={dir(locale)}>
      <body className="flex min-h-screen flex-col bg-bg font-sans text-fg antialiased">
        <a href="#main" className="skip-link">
          {t(locale, 'site.skip')}
        </a>
        <SiteHeader locale={locale} />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <SiteFooter locale={locale} />
        <JsonLd data={orgLd(locale)} />
        <ServiceWorker />
      </body>
    </html>
  );
}
