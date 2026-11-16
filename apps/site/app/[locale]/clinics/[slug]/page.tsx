import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WEEK_ORDER, formatTime12, zonedToUtc } from '@hf/shared';
import { Badge, Bdi, Card } from '@hf/ui';
import { Breadcrumbs, DoctorCard, Section, Stars, Unavailable } from '@/components/site/bits';
import { JsonLd } from '@/components/site/JsonLd';
import { publicGet } from '@/lib/api';
import { governorateName, nameOf, normDoctor, num, osmEmbed, osmLink } from '@/lib/format';
import { asLocale, getT, t, tDyn, type Locale } from '@/lib/i18n';
import { clinicLd } from '@/lib/ld';
import { localeUrl, pageMetadata } from '@/lib/seo';
import type { ClinicDetail } from '@/lib/types';

// Catalogue data is cached for 5 minutes in the data cache (publicGet). The page itself renders per request because
// every response carries a fresh CSP nonce (SEC-6); a pre-rendered/ISR HTML would hold a stale nonce and break scripts.
export const revalidate = 300;

type Props = { params: Promise<{ locale: string; slug: string }> };

const load = (slug: string) => publicGet<ClinicDetail>(`public/clinics/${encodeURIComponent(slug)}`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: l, slug } = await params;
  const locale = asLocale(l);
  const r = await load(slug);
  if (!r.ok) return { title: t(locale, 'clinics.title'), robots: r.status === 404 ? { index: false } : undefined };
  const name = nameOf(locale, r.data);
  return pageMetadata({ locale, path: `/clinics/${slug}`, title: name, description: t(locale, 'clinics.metaClinic', { name, city: r.data.city ?? governorateName(locale, r.data.governorate) }) });
}

function hhmm(time: string, locale: Locale) {
  // Display a wall-clock HH:mm as 12-hour time (LOC-5); any date works for the conversion.
  return formatTime12(zonedToUtc('2026-01-03', time), locale);
}

export default async function ClinicPage({ params }: Props) {
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
  const c = { ...r.data, doctors: (Array.isArray(r.data.doctors) ? r.data.doctors : []).map(normDoctor), working_hours: Array.isArray(r.data.working_hours) ? r.data.working_hours : [] };
  const lat = num(c.lat);
  const lng = num(c.lng);
  const name = nameOf(locale, c);
  const hours = new Map((c.working_hours ?? []).map((h) => [h.weekday, h]));

  return (
    <div className="container-page py-8">
      <Breadcrumbs locale={locale} items={[{ href: `/${locale}`, label: tt('nav.home') }, { href: `/${locale}/clinics`, label: tt('nav.clinics') }, { label: name }]} />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          <p className="text-muted">
            {governorateName(locale, c.governorate)}
            {c.city ? ` · ${c.city}` : ''}
          </p>
          <Stars value={num(c.rating?.avg)} count={c.rating?.count} locale={locale} />
        </div>
        <Link href={`/${locale}/book?clinic=${c.id}`} className="btn-primary h-11 px-6">
          {tt('clinics.book')}
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col gap-4 lg:col-span-1">
          <h2 className="font-bold">{tt('clinics.details')}</h2>
          {c.address_lines && (
            <div>
              <h3 className="text-sm text-muted">{tt('clinics.address')}</h3>
              <p dir="auto">{c.address_lines}</p>
            </div>
          )}
          {!!c.phones?.length && (
            <div>
              <h3 className="text-sm text-muted">{tt('clinics.phones')}</h3>
              <ul>
                {c.phones.map((p) => (
                  <li key={p}>
                    <a href={`tel:${p}`} className="link">
                      <Bdi>{p}</Bdi>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="text-sm text-muted">{tt('clinics.hours')}</h3>
            <table className="w-full text-sm">
              <tbody>
                {WEEK_ORDER.map((wd) => {
                  const h = hours.get(wd);
                  return (
                    <tr key={wd} className="border-b border-border last:border-0">
                      <th scope="row" className="py-1 text-start font-normal">
                        {tDyn(locale, `weekday.${wd}`)}
                      </th>
                      <td className="py-1 text-end">{h ? <span className="num">{`${hhmm(h.open, locale)} – ${hhmm(h.close, locale)}`}</span> : <span className="text-muted">{tt('clinics.closed')}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        {lat !== null && lng !== null && (
          <div className="flex flex-col gap-2 lg:col-span-2">
            <div className="overflow-hidden rounded-xl border border-border">
              <iframe title={tt('clinics.mapOf', { name })} src={osmEmbed(lat, lng)} className="h-72 w-full lg:h-96" loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
            </div>
            <a href={osmLink(lat, lng)} target="_blank" rel="noopener noreferrer" className="link text-sm">
              {tt('clinics.viewMap')}
            </a>
          </div>
        )}
      </div>

      {!!c.specialties?.length && (
        <Section title={tt('clinics.specialties')}>
          <ul className="flex flex-wrap gap-2">
            {c.specialties.map((s) => (
              <li key={s.slug}>
                <Link href={`/${locale}/specialties/${s.slug}`}>
                  <Badge tone="primary">{nameOf(locale, s)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={tt('clinics.doctors')}>
        {c.doctors.length === 0 ? (
          <p className="text-muted">{tt('clinics.noDoctors')}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.doctors.map((d) => (
              <li key={d.id}>
                <DoctorCard doctor={d} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <JsonLd data={{ ...clinicLd(locale, c, c.rating), employee: c.doctors.map((d) => ({ '@type': 'Physician', name: nameOf(locale, d), url: localeUrl(locale, `/doctors/${d.slug}`) })) }} />
    </div>
  );
}
