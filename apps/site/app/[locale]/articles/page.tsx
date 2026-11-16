import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card } from '@hf/ui';
import { Unavailable } from '@/components/site/bits';
import { publicList } from '@/lib/api';
import { dateOnly, pick } from '@/lib/format';
import { asLocale, getT, t, tDyn } from '@/lib/i18n';
import { excerpt, pageMetadata } from '@/lib/seo';
import type { ArticleSummary } from '@/lib/types';

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return pageMetadata({ locale, path: '/articles', title: t(locale, 'articles.title'), description: t(locale, 'articles.metaDescription') });
}

export default async function ArticlesPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  const tt = getT(locale);
  const kindParam = (await searchParams).kind;
  const kind = kindParam === 'news' || kindParam === 'article' ? kindParam : undefined;
  const list = (await publicList<ArticleSummary>('public/articles', { kind }))?.filter((a) => a.kind !== 'page') ?? null;
  const tab = (k: string | undefined, label: string) => (
    <Link href={`/${locale}/articles${k ? `?kind=${k}` : ''}`} aria-current={kind === k ? 'page' : undefined} className={kind === k ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>
      {label}
    </Link>
  );
  return (
    <div className="container-page py-8">
      <h1 className="mb-4 text-2xl font-bold">{tt('articles.title')}</h1>
      <nav className="mb-6 flex gap-2" aria-label={tt('articles.title')}>
        {tab(undefined, tt('site.all'))}
        {tab('article', tt('articles.kind.article'))}
        {tab('news', tt('articles.kind.news'))}
      </nav>
      {list === null ? (
        <Unavailable locale={locale} />
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted">{tt('articles.empty')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => (
            <li key={a.id}>
              <Card className="flex h-full flex-col gap-2">
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <Badge>{tDyn(locale, `articles.kind.${a.kind}`)}</Badge>
                  {a.published_at && <time dateTime={a.published_at}>{dateOnly(a.published_at)}</time>}
                </div>
                <h2 className="font-bold">
                  <Link href={`/${locale}/articles/${a.slug}`} className="hover:text-primary">
                    {pick(locale, a.title_ar, a.title_en)}
                  </Link>
                </h2>
                <p dir="auto" className="text-sm text-muted">
                  {excerpt(pick(locale, a.excerpt_ar, a.excerpt_en), 180)}
                </p>
                <Link href={`/${locale}/articles/${a.slug}`} className="link mt-auto text-sm" aria-hidden tabIndex={-1}>
                  {tt('articles.readMore')}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
