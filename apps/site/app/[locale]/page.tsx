import Link from 'next/link';
import type { Metadata } from 'next';
import { GOVERNORATES } from '@hf/shared';
import { Card } from '@hf/ui';
import { ClinicCard, DoctorCard, Section, Unavailable } from '@/components/site/bits';
import { JsonLd } from '@/components/site/JsonLd';
import { publicList } from '@/lib/api';
import { nameOf } from '@/lib/format';
import { asLocale, getT, t } from '@/lib/i18n';
import { localeUrl, pageMetadata } from '@/lib/seo';
import type { Clinic, Doctor, Specialty } from '@/lib/types';

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return { ...pageMetadata({ locale, path: '', title: t(locale, 'home.metaTitle') }), title: { absolute: t(locale, 'home.metaTitle') } };
}

export default async function Home({ params }: Props) {
  const locale = asLocale((await params).locale);
  const tt = getT(locale);
  const [specialties, doctors, clinics] = await Promise.all([publicList<Specialty>('public/specialties'), publicList<Doctor>('public/doctors'), publicList<Clinic>('public/clinics')]);

  return (
    <>
      <section className="bg-gradient-to-b from-primary/10 to-bg">
        <div className="container-page grid grid-cols-1 gap-8 py-12 md:grid-cols-2 md:py-16">
          <div className="flex flex-col justify-center gap-4">
            <h1 className="text-3xl font-bold leading-tight md:text-4xl">{tt('home.hero.title')}</h1>
            <p className="text-lg text-muted">{tt('home.hero.subtitle')}</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/${locale}/book`} className="btn-primary h-12 px-6">
                {tt('nav.book')}
              </Link>
              <Link href={`/${locale}/clinics`} className="btn-secondary h-12 px-6">
                {tt('nav.clinics')}
              </Link>
            </div>
          </div>
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-bold">{tt('home.search.title')}</h2>
            {/* Plain GET form: works without JavaScript and lands on the server-rendered results (FR-WEB-2). */}
            <form action={`/${locale}/doctors`} method="get" className="flex flex-col gap-3" role="search">
              <div className="flex flex-col gap-1">
                <label htmlFor="hs-specialty" className="text-sm font-medium">
                  {tt('home.search.specialty')}
                </label>
                <select id="hs-specialty" name="specialty" className="h-10 rounded-xl border border-border bg-surface px-3">
                  <option value="">{tt('site.all')}</option>
                  {specialties?.map((s) => (
                    <option key={s.id} value={s.slug}>
                      {nameOf(locale, s)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="hs-gov" className="text-sm font-medium">
                  {tt('home.search.governorate')}
                </label>
                <select id="hs-gov" name="governorate" className="h-10 rounded-xl border border-border bg-surface px-3">
                  <option value="">{tt('site.all')}</option>
                  {GOVERNORATES.map((g) => (
                    <option key={g.slug} value={g.slug}>
                      {g[locale]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="hs-q" className="text-sm font-medium">
                  {tt('home.search.name')}
                </label>
                <input id="hs-q" name="q" maxLength={60} dir="auto" className="h-10 rounded-xl border border-border bg-surface px-3" />
              </div>
              <button type="submit" className="btn-primary mt-2 h-11">
                {tt('home.search.submit')}
              </button>
            </form>
          </Card>
        </div>
      </section>

      <div className="container-page">
        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(['booking', 'payment', 'records'] as const).map((k) => (
            <li key={k}>
              <Card className="h-full">
                <h2 className="mb-1 font-bold">{tt(`home.feature.${k}.title`)}</h2>
                <p className="text-sm text-muted">{tt(`home.feature.${k}.text`)}</p>
              </Card>
            </li>
          ))}
        </ul>

        <Section id="specialties" title={tt('home.specialties')}>
          {specialties === null ? (
            <Unavailable locale={locale} />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {specialties.map((s) => (
                <li key={s.id}>
                  <Link href={`/${locale}/specialties/${s.slug}`} className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 hover:border-primary">
                    <span className="font-medium">{nameOf(locale, s)}</span>
                    {typeof s.doctors === 'number' && <span className="text-sm text-muted">{tt('specialties.doctorsCount', { count: s.doctors })}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          id="doctors"
          title={tt('home.featuredDoctors')}
          action={
            <Link href={`/${locale}/doctors`} className="link text-sm">
              {tt('site.viewAll')}
            </Link>
          }
        >
          {doctors === null ? (
            <Unavailable locale={locale} />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {doctors.slice(0, 6).map((d) => (
                <li key={d.id}>
                  <DoctorCard doctor={d} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          id="clinics"
          title={tt('home.clinics')}
          action={
            <Link href={`/${locale}/clinics`} className="link text-sm">
              {tt('site.viewAll')}
            </Link>
          }
        >
          {clinics === null ? (
            <Unavailable locale={locale} />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {clinics.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <ClinicCard clinic={c} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: t(locale, 'app.name'),
          url: localeUrl(locale),
          inLanguage: locale,
          potentialAction: { '@type': 'SearchAction', target: `${localeUrl(locale, '/doctors')}?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
        }}
      />
    </>
  );
}
