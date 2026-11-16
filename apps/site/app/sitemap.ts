import type { MetadataRoute } from 'next';
import { publicList } from '@/lib/api';
import { LOCALES } from '@/lib/i18n';
import { localeUrl } from '@/lib/seo';
import type { ArticleSummary, Clinic, Doctor, Specialty } from '@/lib/types';

export const revalidate = 3600;

const STATIC = ['', '/clinics', '/doctors', '/specialties', '/services', '/book', '/articles', '/privacy', '/terms'];

/** FR-WEB-4 sitemap with hreflang alternates for every page. The patient portal is excluded. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [clinics, doctors, specialties, articles] = await Promise.all([
    publicList<Clinic>('public/clinics'),
    publicList<Doctor>('public/doctors'),
    publicList<Specialty>('public/specialties'),
    publicList<ArticleSummary>('public/articles'),
  ]);
  const paths: { path: string; lastModified?: string; priority: number }[] = [
    ...STATIC.map((path) => ({ path, priority: path === '' ? 1 : 0.7 })),
    ...(clinics ?? []).map((c) => ({ path: `/clinics/${c.slug}`, priority: 0.8 })),
    ...(doctors ?? []).map((d) => ({ path: `/doctors/${d.slug}`, priority: 0.8 })),
    ...(specialties ?? []).map((s) => ({ path: `/specialties/${s.slug}`, priority: 0.6 })),
    ...(articles ?? []).map((a) => ({ path: `/articles/${a.slug}`, lastModified: a.published_at ?? undefined, priority: 0.5 })),
  ];
  return paths.flatMap(({ path, lastModified, priority }) =>
    LOCALES.map((locale) => ({
      url: localeUrl(locale, path),
      lastModified,
      priority,
      alternates: { languages: Object.fromEntries(LOCALES.map((l) => [l === 'ar' ? 'ar-EG' : 'en', localeUrl(l, path)])) },
    })),
  );
}
