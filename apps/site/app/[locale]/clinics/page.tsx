import type { Metadata } from 'next';
import { GOVERNORATES } from '@hf/shared';
import { ClinicCard, Unavailable } from '@/components/site/bits';
import { JsonLd } from '@/components/site/JsonLd';
import { publicList } from '@/lib/api';
import { num, osmBboxEmbed, osmLink } from '@/lib/format';
import { asLocale, getT, t } from '@/lib/i18n';
import { clinicLd } from '@/lib/ld';
import { pageMetadata } from '@/lib/seo';
import type { Clinic } from '@/lib/types';

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return pageMetadata({ locale, path: '/clinics', title: t(locale, 'clinics.title'), description: t(locale, 'clinics.metaDescription') });
}

export default async function ClinicsPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  const sp = await searchParams;
  const tt = getT(locale);
  const gov = typeof sp.governorate === 'string' && GOVERNORATES.some((g) => g.slug === sp.governorate) ? sp.governorate : undefined;
  const clinics = await publicList<Clinic>('public/clinics', { governorate: gov });
  const points = (clinics ?? []).map((c) => ({ lat: num(c.lat), lng: num(c.lng) })).filter((p): p is { lat: number; lng: number } => p.lat !== null && p.lng !== null);
  const map = osmBboxEmbed(points);

  return (
    <div className="container-page py-8">
      <h1 className="text-2xl font-bold">{tt('clinics.title')}</h1>
      <p className="mb-6 text-muted">{tt('clinics.subtitle')}</p>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor="cl-gov" className="text-sm font-medium">
            {tt('clinics.filter.governorate')}
          </label>
          <select id="cl-gov" name="governorate" defaultValue={gov ?? ''} className="h-10 rounded-xl border border-border bg-surface px-3">
            <option value="">{tt('site.all')}</option>
            {GOVERNORATES.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g[locale]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">
          {tt('clinics.filter.apply')}
        </button>
      </form>

      {clinics === null ? (
        <Unavailable locale={locale} />
      ) : clinics.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted">{tt('clinics.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
            {clinics.map((c) => {
              const lat = num(c.lat);
              const lng = num(c.lng);
              return (
                <li key={c.id} className="flex flex-col gap-2">
                  <ClinicCard clinic={c} locale={locale} />
                  {lat !== null && lng !== null && (
                    <a href={osmLink(lat, lng)} target="_blank" rel="noopener noreferrer" className="link text-sm">
                      {tt('clinics.viewMap')}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {map && (
            <div className="overflow-hidden rounded-xl border border-border lg:sticky lg:top-4 lg:self-start">
              <iframe title={tt('clinics.map')} src={map} className="h-80 w-full lg:h-[32rem]" loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
            </div>
          )}
        </div>
      )}
      {clinics && clinics.length > 0 && <JsonLd data={clinics.map((c) => clinicLd(locale, c))} />}
    </div>
  );
}
