import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs, Unavailable } from '@/components/site/bits';
import { JsonLd } from '@/components/site/JsonLd';
import { publicGet } from '@/lib/api';
import { dateOnly, paragraphs, pick } from '@/lib/format';
import { asLocale, getT, t } from '@/lib/i18n';
import { excerpt, localeUrl, pageMetadata } from '@/lib/seo';
import type { Article } from '@/lib/types';

// Catalogue data is cached for 5 minutes in the data cache (publicGet). The page itself renders per request because
// every response carries a fresh CSP nonce (SEC-6); a pre-rendered/ISR HTML would hold a stale nonce and break scripts.
export const revalidate = 300;

type Props = { params: Promise<{ locale: string; slug: string }> };

const load = (slug: string) => publicGet<Article>(`public/articles/${encodeURIComponent(decodeURIComponent(slug))}`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: l, slug } = await params;
  const locale = asLocale(l);
  const r = await load(slug);
  if (!r.ok) return { title: t(locale, 'articles.title') };
  const a = r.data;
  return {
    ...pageMetadata({ locale, path: `/articles/${a.slug}`, type: 'article', title: pick(locale, a.title_ar, a.title_en), description: excerpt(pick(locale, a.body_ar, a.body_en)) }),
  };
}

export default async function ArticlePage({ params }: Props) {
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
  const a = r.data;
  const title = pick(locale, a.title_ar, a.title_en);
  // Fall back to the Arabic body when no English version exists; mark its language for screen readers.
  const body = locale === 'en' && a.body_en ? a.body_en : a.body_ar;
  const bodyLang = locale === 'en' && a.body_en ? 'en' : 'ar';
  return (
    <article className="container-page max-w-3xl py-8">
      <Breadcrumbs locale={locale} items={[{ href: `/${locale}`, label: tt('nav.home') }, { href: `/${locale}/articles`, label: tt('nav.articles') }, { label: title }]} />
      <h1 className="mb-2 text-3xl font-bold">{title}</h1>
      <p className="mb-8 text-sm text-muted">
        {a.published_at && <time dateTime={a.published_at}>{dateOnly(a.published_at)}</time>}
        {a.updated_at && a.updated_at !== a.published_at && (
          <>
            {' · '}
            {tt('articles.updated')} <time dateTime={a.updated_at}>{dateOnly(a.updated_at)}</time>
          </>
        )}
      </p>
      <div lang={bodyLang} dir={bodyLang === 'ar' ? 'rtl' : 'ltr'} className="space-y-4 text-lg leading-relaxed">
        {paragraphs(body).map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
      </div>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': a.kind === 'news' ? 'NewsArticle' : 'MedicalWebPage',
          headline: title,
          datePublished: a.published_at ?? undefined,
          dateModified: a.updated_at ?? undefined,
          inLanguage: bodyLang,
          url: localeUrl(locale, `/articles/${a.slug}`),
          publisher: { '@type': 'MedicalOrganization', name: t(locale, 'app.name') },
        }}
      />
    </article>
  );
}
