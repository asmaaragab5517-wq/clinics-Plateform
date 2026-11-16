import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Bdi, Card } from '@hf/ui';
import { ClearBooking } from '@/components/booking/ClearBooking';
import { asLocale, getT, t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return { title: t(locale, 'booking.result.title'), robots: { index: false, follow: false } };
}

/** HealthPay return page: `?ref=&status=payment.captured|payment.failed`. The webhook remains the source of truth. */
export default async function BookResult({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  const tt = getT(locale);
  const sp = await searchParams;
  const ref = typeof sp.ref === 'string' ? sp.ref.replace(/[^\w-]/g, '').slice(0, 40) : '';
  const status = typeof sp.status === 'string' ? sp.status : '';
  const outcome = /captured|success|paid/.test(status) ? 'success' : /fail|cancel|declin|expired/.test(status) ? 'failed' : 'pending';
  return (
    <div className="container-page max-w-lg py-12">
      <Card className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">{tt('booking.result.title')}</h1>
        <Alert tone={outcome === 'success' ? 'success' : outcome === 'failed' ? 'danger' : 'info'}>{tt(`booking.result.${outcome}`)}</Alert>
        {ref && (
          <p>
            <span className="text-muted">{tt('booking.ref')}: </span>
            <Bdi className="num font-bold">{ref}</Bdi>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href={`/${locale}/portal`} className="btn-primary">
            {tt('booking.goToAccount')}
          </Link>
          {outcome === 'failed' && (
            <Link href={`/${locale}/book`} className="btn-secondary">
              {tt('site.retry')}
            </Link>
          )}
        </div>
      </Card>
      {outcome === 'success' && <ClearBooking />}
    </div>
  );
}
