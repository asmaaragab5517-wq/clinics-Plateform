import type { Metadata } from 'next';
import Link from 'next/link';
import { Unavailable } from '@/components/site/bits';
import { JsonLd } from '@/components/site/JsonLd';
import { publicList } from '@/lib/api';
import { nameOf } from '@/lib/format';
import { asLocale, getT, t } from '@/lib/i18n';
import { specialtyLd } from '@/lib/ld';
import { pageMetadata } from '@/lib/seo';
import type { Specialty } from '@/lib/types';

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return pageMetadata({ locale, path: '/specialties', title: t(locale, 'specialties.title'), description: t(locale, 'specialties.metaDescription') });
}

export default async function SpecialtiesPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  const tt = getT(locale);
  const list = await publicList<Specialty>('public/specialties');
  return (
    <div className="container-page py-8">
      <h1 className="mb-6 text-2xl font-bold">{tt('specialties.title')}</h1>
      {list === null ? (
        <Unavailable locale={locale} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((s) => (
            <li key={s.id}>
              <Link href={`/${locale}/specialties/${s.slug}`} className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 hover:border-primary">
                <span className="font-medium">{nameOf(locale, s)}</span>
                {typeof s.doctors === 'number' && <span className="text-sm text-muted">{tt('specialties.doctorsCount', { count: s.doctors })}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list && list.length > 0 && <JsonLd data={list.map((s) => specialtyLd(locale, s))} />}
    </div>
  );
}
