import type { Metadata } from 'next';
import { LegalPage } from '@/components/site/Legal';
import { asLocale, t } from '@/lib/i18n';
import { pageMetadata } from '@/lib/seo';

export const revalidate = 86400;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return pageMetadata({ locale, path: '/privacy', title: t(locale, 'privacy.title'), description: t(locale, 'privacy.metaDescription') });
}

export default async function Page({ params }: Props) {
  const locale = asLocale((await params).locale);
  return <LegalPage locale={locale} prefix="privacy" title={t(locale, 'privacy.title')} updated="01/11/2026" />;
}
