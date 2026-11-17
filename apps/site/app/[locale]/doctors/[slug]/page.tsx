import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Bdi, Card, Table } from '@hf/ui';
import { Breadcrumbs, Section, Stars, Unavailable } from '@/components/site/bits';
import { DoctorPhoto } from '@/components/site/DoctorPhoto';
import { JsonLd } from '@/components/site/JsonLd';
import { publicGet } from '@/lib/api';
import { dateOnly, dateTime, doctorPhotoSrc, doctorTitle, listSep, money, nameOf, normDoctor, num, pick } from '@/lib/format';
import { asLocale, getT, has, t, tDyn } from '@/lib/i18n';
import { physicianLd } from '@/lib/ld';
import { excerpt, pageMetadata } from '@/lib/seo';
import type { DoctorDetail } from '@/lib/types';

// Catalogue data is cached for 5 minutes in the data cache (publicGet). The page itself renders per request because
// every response carries a fresh CSP nonce (SEC-6); a pre-rendered/ISR HTML would hold a stale nonce and break scripts.
export const revalidate = 300;

type Props = { params: Promise<{ locale: string; slug: string }> };

const load = (slug: string) => publicGet<DoctorDetail>(`public/doctors/${encodeURIComponent(slug)}`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: l, slug } = await params;
  const locale = asLocale(l);
  const r = await load(slug);
  if (!r.ok) return { title: t(locale, 'doctors.title') };
  const d = normDoctor(r.data);
  const name = nameOf(locale, d);
  const specialty = d.specialties.map((s) => nameOf(locale, s)).join(listSep(locale));
  return pageMetadata({
    locale,
    path: `/doctors/${slug}`,
    type: 'profile',
    title: specialty ? `${name} - ${specialty}` : name,
    description: excerpt(pick(locale, d.bio_ar, d.bio_en)) || t(locale, 'doctor.metaDoctor', { name, specialty }),
  });
}

export default async function DoctorPage({ params }: Props) {
  const { locale: l, slug } = await params;
  const locale = asLocale(l);
  const tt = getT(locale);
  const r = await load(slug);
  if (!r.ok && r.status === 404) notFound();
  if (!r.ok)
    return (
      <div className="container-page py-8">
        <Unavailable locale={locale} />
      </div>
    );
  const d = { ...normDoctor(r.data), services: Array.isArray(r.data.services) ? r.data.services : [], reviews: Array.isArray(r.data.reviews) ? r.data.reviews : [] };
  const name = nameOf(locale, d);
  const bio = pick(locale, d.bio_ar, d.bio_en);
  const clinicName = (id: string | null) => (id ? nameOf(locale, d.clinics.find((c) => c.id === id)) : '');

  return (
    <div className="container-page py-8">
      <Breadcrumbs locale={locale} items={[{ href: `/${locale}`, label: tt('nav.home') }, { href: `/${locale}/doctors`, label: tt('nav.doctors') }, { label: name }]} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="flex items-start gap-4">
            <DoctorPhoto name={name} src={doctorPhotoSrc(d)} size="lg" />
            <div>
              <h1 className="text-2xl font-bold">
                <Bdi>{name}</Bdi>
              </h1>
              <p className="text-muted">{[doctorTitle(locale, d.title), ...d.specialties.map((s) => nameOf(locale, s))].filter(Boolean).join(' · ')}</p>
              <Stars value={num(d.rating_avg)} count={d.rating_count} locale={locale} />
              {d.syndicate_number && (
                <p className="text-sm text-muted">
                  {tt('doctor.syndicate')}: <Bdi className="num">{d.syndicate_number}</Bdi>
                </p>
              )}
            </div>
          </div>
          {bio && (
            <section aria-labelledby="about">
              <h2 id="about" className="mb-2 text-lg font-bold">
                {tt('doctor.about')}
              </h2>
              <p dir="auto" className="whitespace-pre-line">
                {bio}
              </p>
            </section>
          )}
          {!!d.qualifications?.length && (
            <section aria-labelledby="quals">
              <h2 id="quals" className="mb-2 text-lg font-bold">
                {tt('doctor.qualifications')}
              </h2>
              <ul className="list-disc ps-5 [overflow-wrap:anywhere]">
                {d.qualifications.map((q, i) => (
                  <li key={i}>
                    {/* dir="auto" on the text, not the <li>: an LTR <li> in an RTL list moves its bullet outside the padding. */}
                    <span dir="auto">{[q.degree, q.institution, q.year].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!d.languages?.length && (
            <p className="text-sm">
              <span className="text-muted">{tt('doctor.languages')}: </span>
              {d.languages.map((x) => (has(`lang.${x}`) ? tDyn(locale, `lang.${x}`) : x)).join(listSep(locale))}
            </p>
          )}
        </div>

        <Card className="flex h-fit flex-col gap-3 lg:sticky lg:top-4">
          {num(d.fee) !== null && (
            <p>
              <span className="text-muted">{tt('doctor.fee')}: </span>
              <span className="num text-lg font-bold">{money(num(d.fee), locale)}</span>
            </p>
          )}
          <p className="text-sm">
            <span className="text-muted">{tt('doctor.nextAvailable')}: </span>
            {d.nextAvailable ? <span className="num font-medium">{dateTime(d.nextAvailable, locale)}</span> : tt('doctor.noAvailability')}
          </p>
          {d.clinics.length > 0 && (
            <div>
              <h2 className="text-sm text-muted">{tt('doctor.clinics')}</h2>
              <ul className="flex flex-wrap gap-1">
                {d.clinics.map((c) => (
                  <li key={c.id}>
                    <Link href={`/${locale}/clinics/${c.slug}`}>
                      <Badge tone="primary">{nameOf(locale, c)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link href={`/${locale}/book?doctor=${encodeURIComponent(d.slug)}`} className="btn-primary h-12">
            {tt('doctor.book')}
          </Link>
        </Card>
      </div>

      {d.services.length > 0 && (
        <Section title={tt('doctor.services')}>
          <Table>
            <thead>
              <tr>
                <th scope="col">{tt('services.service')}</th>
                <th scope="col">{tt('services.duration')}</th>
                <th scope="col">{tt('services.price')}</th>
              </tr>
            </thead>
            <tbody>
              {d.services.map((s) => (
                <tr key={s.id}>
                  <td>{nameOf(locale, s)}</td>
                  <td className="num">{tt('services.minutes', { minutes: s.duration_minutes })}</td>
                  <td>
                    <ul>
                      {(s.prices ?? []).map((p, i) => (
                        <li key={i} className="flex flex-wrap gap-2">
                          <span className="num font-medium">{money(p.price, locale)}</span>
                          {d.clinics.length > 1 && p.clinicId && <span className="text-muted">{clinicName(p.clinicId)}</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section title={tt('doctor.reviews')}>
        {d.reviews.length === 0 ? (
          <p className="text-muted">{tt('doctor.noReviews')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {d.reviews.map((rv, i) => (
              <li key={i}>
                <Card>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">
                      <Bdi>{rv.display_name}</Bdi>
                    </span>
                    <span className="text-xs text-muted">{dateOnly(rv.created_at)}</span>
                  </div>
                  <span aria-label={tt('review.star', { count: rv.rating })} className="text-warning">
                    {'★'.repeat(rv.rating)}
                    <span className="text-border">{'★'.repeat(5 - rv.rating)}</span>
                  </span>
                  {rv.comment && (
                    <p dir="auto" className="mt-1 text-sm">
                      {rv.comment}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <JsonLd data={physicianLd(locale, d)} />
    </div>
  );
}
