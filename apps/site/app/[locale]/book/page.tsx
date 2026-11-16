import type { Metadata } from 'next';
import { BookingWizard } from '@/components/booking/BookingWizard';
import { publicList } from '@/lib/api';
import { asLocale, t } from '@/lib/i18n';
import { pageMetadata } from '@/lib/seo';
import type { Clinic, Specialty } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return pageMetadata({ locale, path: '/book', title: t(locale, 'booking.title'), description: t(locale, 'booking.metaDescription') });
}

const str = (v: string | string[] | undefined, max = 80) => (typeof v === 'string' && v.length <= max ? v : undefined);

export default async function BookPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  const sp = await searchParams;
  const [clinics, specialties] = await Promise.all([publicList<Clinic>('public/clinics'), publicList<Specialty>('public/specialties')]);
  return (
    <div className="container-page max-w-4xl py-8">
      <h1 className="mb-6 text-2xl font-bold">{t(locale, 'booking.title')}</h1>
      <BookingWizard locale={locale} clinics={clinics ?? []} specialties={specialties ?? []} initial={{ doctor: str(sp.doctor), clinic: str(sp.clinic, 36), specialty: str(sp.specialty) }} />
    </div>
  );
}
