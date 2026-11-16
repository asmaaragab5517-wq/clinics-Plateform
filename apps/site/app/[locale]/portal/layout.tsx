import type { Metadata } from 'next';
import { asLocale, t } from '@/lib/i18n';

/** FR-WEB-6: patient pages are dynamic, never cached, never indexed. */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return { title: t(locale, 'portal.metaTitle'), robots: { index: false, follow: false, nocache: true } };
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
