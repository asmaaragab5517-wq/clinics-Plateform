import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, parseLocale, translate } from '@/lib/i18n';
import { OfflineActions } from './offline-actions';

export async function generateMetadata(): Promise<Metadata> {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { title: translate(locale, 'pwa.offlineTitle') };
}

/** Served by the service worker when a page is requested without a connection (NFR-7). Public, no patient data. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <OfflineActions />
    </main>
  );
}
