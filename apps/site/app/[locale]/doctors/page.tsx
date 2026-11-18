import type { Metadata } from 'next';
import Link from 'next/link';
import { GOVERNORATES, addDays, localDate, toWesternDigits } from '@hf/shared';
import { Card } from '@hf/ui';
import { DoctorCard, Unavailable } from '@/components/site/bits';
import { JsonLd } from '@/components/site/JsonLd';
import { LocationFilter } from '@/components/site/LocationFilter';
import { publicList } from '@/lib/api';
import { citiesOf, nameOf } from '@/lib/format';
import { asLocale, getT, t } from '@/lib/i18n';
import { physicianLd } from '@/lib/ld';
import { pageMetadata } from '@/lib/seo';
import type { Clinic, Doctor, Specialty } from '@/lib/types';

export const revalidate = 300;

type SP = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SP> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: SP[string]) => (typeof v === 'string' ? v.trim() : '');
const egp = (v: SP[string]) => {
  const n = Number(toWesternDigits(str(v)));
  return str(v) && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

/** The API computes "next available" for every doctor over 30 days, so "available by" is offered from today to today + 29 (clinic time). */
const AVAILABILITY_DAYS = 30;

/** FR-WEB-2 filters, all in the query string so results are server-rendered and shareable. */
function parseFilters(sp: SP) {
  const rating = Number(str(sp.rating));
  const governorate = GOVERNORATES.some((g) => g.slug === str(sp.governorate)) ? str(sp.governorate) : undefined;
  const today = localDate(new Date());
  const by = toWesternDigits(str(sp.availableBy));
  return {
    specialty: str(sp.specialty).slice(0, 80) || undefined,
    governorate,
    // A city is accepted only together with its governorate (cities repeat across governorates).
    city: governorate && citiesOf(governorate).some((c) => c.ar === str(sp.city)) ? str(sp.city) : undefined,
    availableBy: /^\d{4}-\d{2}-\d{2}$/.test(by) && by >= today && by <= addDays(today, AVAILABILITY_DAYS - 1) ? by : undefined,
    today,
    clinicId: UUID.test(str(sp.clinic)) ? str(sp.clinic) : undefined,
    gender: str(sp.gender) === 'male' || str(sp.gender) === 'female' ? str(sp.gender) : undefined,
    minFeeEgp: egp(sp.minFee),
    maxFeeEgp: egp(sp.maxFee),
    minRating: rating >= 1 && rating <= 5 ? rating : undefined,
    q: str(sp.q).slice(0, 60) || undefined,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return pageMetadata({ locale, path: '/doctors', title: t(locale, 'doctors.title'), description: t(locale, 'doctors.metaDescription') });
}

export default async function DoctorsPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  const tt = getT(locale);
  const f = parseFilters(await searchParams);
  const activeFilters = (Object.keys(f) as (keyof typeof f)[]).filter((k) => k !== 'today' && f[k] !== undefined).length;
  const [doctors, specialties, clinics] = await Promise.all([
    publicList<Doctor>('public/doctors', {
      specialty: f.specialty,
      governorate: f.governorate,
      city: f.city,
      availableBy: f.availableBy,
      clinicId: f.clinicId,
      gender: f.gender,
      minFee: f.minFeeEgp !== undefined ? f.minFeeEgp * 100 : undefined,
      maxFee: f.maxFeeEgp !== undefined ? f.maxFeeEgp * 100 : undefined,
      minRating: f.minRating,
      q: f.q,
    }),
    publicList<Specialty>('public/specialties'),
    publicList<Clinic>('public/clinics'),
  ]);
  const selectCls = 'h-10 w-full rounded-xl border border-border bg-surface px-3';

  return (
    <div className="container-page py-8">
      <h1 className="mb-6 text-2xl font-bold">{tt('doctors.title')}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <Card className="h-fit lg:sticky lg:top-4">
          {/* On phones the filters fold behind a toggle so the doctors show first (they open when filters are in use);
              a visually hidden checkbox keeps it working without JavaScript. Large screens always show the form. */}
          <input type="checkbox" id="f-toggle" className="peer sr-only lg:hidden" defaultChecked={activeFilters > 0} aria-controls="f-panel" aria-label={tt('filter.title')} />
          <label htmlFor="f-toggle" className="btn-secondary btn-sm w-full cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-primary lg:hidden">
            {tt('filter.title')}
            {activeFilters > 0 && <span className="num rounded-full bg-primary px-2 text-xs text-primary-fg">{activeFilters}</span>}
          </label>
          <form id="f-panel" method="get" className="mt-3 hidden flex-col gap-3 peer-checked:flex lg:mt-0 lg:flex" role="search" aria-label={tt('filter.title')}>
            <h2 className="hidden font-bold lg:block">{tt('filter.title')}</h2>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-q" className="text-sm font-medium">
                {tt('filter.name')}
              </label>
              <input id="f-q" name="q" defaultValue={f.q} maxLength={60} dir="auto" className={selectCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-specialty" className="text-sm font-medium">
                {tt('filter.specialty')}
              </label>
              <select id="f-specialty" name="specialty" defaultValue={f.specialty ?? ''} className={selectCls}>
                <option value="">{tt('site.all')}</option>
                {specialties?.map((s) => (
                  <option key={s.id} value={s.slug}>
                    {nameOf(locale, s)}
                  </option>
                ))}
              </select>
            </div>
            <LocationFilter locale={locale} governorate={f.governorate} city={f.city} className={selectCls} />
            <div className="flex flex-col gap-1">
              <label htmlFor="f-by" className="text-sm font-medium">
                {tt('filter.availableBy')}
              </label>
              <input id="f-by" name="availableBy" type="date" min={f.today} max={addDays(f.today, AVAILABILITY_DAYS - 1)} defaultValue={f.availableBy} aria-describedby="f-by-hint" className={selectCls} />
              <span id="f-by-hint" className="text-xs text-muted">
                {tt('filter.availableByHint')}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-clinic" className="text-sm font-medium">
                {tt('filter.clinic')}
              </label>
              <select id="f-clinic" name="clinic" defaultValue={f.clinicId ?? ''} className={selectCls}>
                <option value="">{tt('site.all')}</option>
                {clinics?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nameOf(locale, c)}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{tt('filter.gender')}</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {(['', 'male', 'female'] as const).map((g) => (
                  <label key={g || 'any'} className="inline-flex items-center gap-1">
                    <input type="radio" name="gender" value={g} defaultChecked={(f.gender ?? '') === g} />
                    {g ? tt(`patient.${g}`) : tt('site.all')}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="f-min" className="text-sm font-medium">
                  {tt('filter.minFee')}
                </label>
                <input id="f-min" name="minFee" type="number" inputMode="numeric" min={0} step={10} defaultValue={f.minFeeEgp} className={selectCls} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="f-max" className="text-sm font-medium">
                  {tt('filter.maxFee')}
                </label>
                <input id="f-max" name="maxFee" type="number" inputMode="numeric" min={0} step={10} defaultValue={f.maxFeeEgp} className={selectCls} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-rating" className="text-sm font-medium">
                {tt('filter.rating')}
              </label>
              <select id="f-rating" name="rating" defaultValue={f.minRating ? String(f.minRating) : ''} className={selectCls}>
                <option value="">{tt('site.all')}</option>
                {[4, 3, 2].map((r) => (
                  <option key={r} value={r}>
                    {tt('filter.ratingAtLeast', { rating: r })}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary">
              {tt('filter.apply')}
            </button>
            <Link href={`/${locale}/doctors`} className="link text-center text-sm">
              {tt('filter.reset')}
            </Link>
          </form>
        </Card>
        <div className="lg:col-span-3">
          {doctors === null ? (
            <Unavailable locale={locale} />
          ) : (
            <>
              <p className="mb-4 text-sm text-muted" role="status">
                {tt('doctors.results', { count: doctors.length })}
              </p>
              {doctors.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted">{tt('doctors.empty')}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {doctors.map((d) => (
                    <li key={d.id}>
                      <DoctorCard doctor={d} locale={locale} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
      {doctors && doctors.length > 0 && <JsonLd data={doctors.slice(0, 20).map((d) => physicianLd(locale, d))} />}
    </div>
  );
}
