import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs, DoctorCard, Unavailable } from '@/components/site/bits';
import { JsonLd } from '@/components/site/JsonLd';
import { publicList } from '@/lib/api';
import { nameOf } from '@/lib/format';
import { asLocale, getT, t } from '@/lib/i18n';
import { physicianLd, specialtyLd } from '@/lib/ld';
import { pageMetadata } from '@/lib/seo';
import type { Doctor, Specialty } from '@/lib/types';

// Catalogue data is cached for 5 minutes in the data cache (publicGet). The page itself renders per request because
// every response carries a fresh CSP nonce (SEC-6); a pre-rendered/ISR HTML would hold a stale nonce and break scripts.
export const revalidate = 300;

type Props = { params: Promise<{ locale: string; slug: string }> };

async function findSpecialty(slug: string) {
  const list = await publicList<Specialty>('public/specialties');
  return { list, specialty: list?.find((s) => s.slug === decodeURIComponent(slug)) ?? null };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: l, slug } = await params;
  const locale = asLocale(l);
  const { specialty } = await findSpecialty(slug);
  if (!specialty) return { title: t(locale, 'specialties.title') };
  const name = nameOf(locale, specialty);
  return pageMetadata({ locale, path: `/specialties/${specialty.slug}`, title: t(locale, 'specialties.doctorsIn', { name }), description: t(locale, 'specialties.metaSpecialty', { name }) });
}

export default async function SpecialtyPage({ params }: Props) {
  const { locale: l, slug } = await params;
  const locale = asLocale(l);
  const tt = getT(locale);
  const { list, specialty } = await findSpecialty(slug);
  if (list && !specialty) notFound();
  const doctors = specialty ? await publicList<Doctor>('public/doctors', { specialty: specialty.slug }) : null;
  const name = specialty ? nameOf(locale, specialty) : '';

  return (
    <div className="container-page py-8">
      <Breadcrumbs locale={locale} items={[{ href: `/${locale}`, label: tt('nav.home') }, { href: `/${locale}/specialties`, label: tt('nav.specialties') }, ...(specialty ? [{ label: name }] : [])]} />
      {specialty && <h1 className="mb-6 text-2xl font-bold">{tt('specialties.doctorsIn', { name })}</h1>}
      {doctors === null ? (
        <Unavailable locale={locale} />
      ) : doctors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted">{tt('specialties.empty')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((d) => (
            <li key={d.id}>
              <DoctorCard doctor={d} locale={locale} />
            </li>
          ))}
        </ul>
      )}
      {specialty && <JsonLd data={[specialtyLd(locale, specialty), ...(doctors ?? []).map((d) => physicianLd(locale, d))]} />}
    </div>
  );
}
