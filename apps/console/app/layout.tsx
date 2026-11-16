import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@hf/ui/styles.css';
import './globals.css';
import { I18nProvider } from '@/components/i18n';
import { LOCALE_COOKIE, parseLocale, translate } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { title: { default: translate(locale, 'shell.title'), template: `%s · ${translate(locale, 'app.name')}` }, robots: { index: false, follow: false } };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  // Reading the nonce marks every page dynamic; Next applies it to its own scripts from the CSP request header.
  await headers();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
