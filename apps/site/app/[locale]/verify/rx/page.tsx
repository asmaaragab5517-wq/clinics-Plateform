import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@hf/ui';
import { asLocale, getT, t } from '@/lib/i18n';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return pageMetadata({ locale, path: '/verify/rx', title: t(locale, 'verify.title'), description: t(locale, 'verify.metaDescription') });
}

export default async function VerifyForm({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  const code = (await searchParams).code;
  if (typeof code === 'string' && code.trim()) redirect(`/${locale}/verify/rx/${encodeURIComponent(code.trim().slice(0, 40))}`);
  const tt = getT(locale);
  return (
    <div className="container-page max-w-lg py-12">
      <Card className="p-6">
        <h1 className="mb-4 text-2xl font-bold">{tt('verify.title')}</h1>
        <form method="get" className="flex flex-col gap-3">
          <label htmlFor="rx-code" className="text-sm font-medium">
            {tt('verify.code')}
          </label>
          <input id="rx-code" name="code" required maxLength={40} dir="ltr" autoComplete="off" className="num h-11 rounded-xl border border-border bg-surface px-3" />
          <button type="submit" className="btn-primary">
            {tt('common.search')}
          </button>
        </form>
        <p className="mt-4 text-sm text-muted">{tt('verify.note')}</p>
      </Card>
    </div>
  );
}
