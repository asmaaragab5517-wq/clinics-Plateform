import { governorateName, nameOf, num } from './format';
import type { Locale } from './i18n';
import { localeUrl } from './seo';
import type { Clinic, Doctor, DoctorDetail, Review, SpecialtyRef } from './types';

/** schema.org builders (FR-WEB-4). Only public catalogue data. */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function aggregateRating(avg: unknown, count: number | null | undefined) {
  const v = num(avg as number | string | null);
  if (v === null || !count) return undefined;
  return { '@type': 'AggregateRating', ratingValue: Number(v.toFixed(2)), reviewCount: count, bestRating: 5, worstRating: 1 };
}

export function clinicLd(locale: Locale, c: Clinic, rating?: { avg: unknown; count: number }) {
  const lat = num(c.lat);
  const lng = num(c.lng);
  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    '@id': localeUrl(locale, `/clinics/${c.slug}#clinic`),
    name: nameOf(locale, c),
    url: localeUrl(locale, `/clinics/${c.slug}`),
    telephone: c.phones?.[0],
    email: c.email ?? undefined,
    address: { '@type': 'PostalAddress', streetAddress: c.address_lines ?? undefined, addressLocality: c.city ?? undefined, addressRegion: governorateName(locale, c.governorate), addressCountry: 'EG' },
    ...(lat !== null && lng !== null ? { geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lng } } : {}),
    openingHoursSpecification: (c.working_hours ?? []).map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAYS[h.weekday], opens: h.open, closes: h.close })),
    medicalSpecialty: c.specialties?.map((s) => nameOf(locale, s)),
    aggregateRating: rating ? aggregateRating(rating.avg, rating.count) : undefined,
  };
}

export function physicianLd(locale: Locale, d: Doctor | DoctorDetail) {
  const detail = d as Partial<DoctorDetail>;
  return {
    '@context': 'https://schema.org',
    '@type': 'Physician',
    '@id': localeUrl(locale, `/doctors/${d.slug}#physician`),
    name: nameOf(locale, d),
    url: localeUrl(locale, `/doctors/${d.slug}`),
    medicalSpecialty: d.specialties.map((s) => nameOf(locale, s)),
    knowsLanguage: d.languages ?? undefined,
    description: (locale === 'en' && d.bio_en) || d.bio_ar || undefined,
    workLocation: d.clinics.map((c) => ({ '@type': 'MedicalClinic', name: nameOf(locale, c), url: localeUrl(locale, `/clinics/${c.slug}`) })),
    aggregateRating: aggregateRating(d.rating_avg, d.rating_count),
    review: detail.reviews?.slice(0, 5).map((r: Review) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 },
      author: { '@type': 'Person', name: r.display_name },
      datePublished: r.created_at?.slice(0, 10),
      reviewBody: r.comment ?? undefined,
    })),
  };
}

export function specialtyLd(locale: Locale, s: SpecialtyRef) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalSpecialty',
    name: nameOf(locale, s),
    url: localeUrl(locale, `/specialties/${s.slug}`),
  };
}
