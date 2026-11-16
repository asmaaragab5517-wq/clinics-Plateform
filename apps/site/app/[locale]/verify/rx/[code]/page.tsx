import type { Metadata } from 'next';
import { Alert, Bdi, Card } from '@hf/ui';
import { Unavailable } from '@/components/site/bits';
import { publicGet } from '@/lib/api';
import { dateOnly } from '@/lib/format';
import { asLocale, getT, t } from '@/lib/i18n';
import type { RxVerification } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  // Verification pages are per-prescription: never indexed.
  return { title: t(locale, 'verify.title'), robots: { index: false, follow: false } };
}

/** FR-RX-5: shows validity only, never the prescription contents. */
export default async function VerifyRx({ params }: Props) {
  const { locale: l, code: raw } = await params;
  const locale = asLocale(l);
  const tt = getT(locale);
  const code = decodeURIComponent(raw).slice(0, 40);
  const r = await publicGet<RxVerification>(`public/verify/rx/${encodeURIComponent(code)}`, undefined, 0);
  return (
    <div className="container-page max-w-lg py-12">
      <Card className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">{tt('verify.title')}</h1>
        <p className="text-sm">
          <span className="text-muted">{tt('verify.code')}: </span>
          <Bdi className="num font-medium">{code}</Bdi>
        </p>
        {!r.ok && r.status !== 404 ? (
          <Unavailable locale={locale} />
        ) : r.ok && r.data.valid ? (
          <>
            <Alert tone="success">{tt('rx.verifyValid')}</Alert>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              {r.data.issuedAt && (
                <>
                  <dt className="text-muted">{tt('verify.issuedAt')}</dt>
                  <dd className="num col-span-2">{dateOnly(r.data.issuedAt)}</dd>
                </>
              )}
              {r.data.doctor && (
                <>
                  <dt className="text-muted">{tt('verify.doctor')}</dt>
                  <dd className="col-span-2">
                    <Bdi>{r.data.doctor}</Bdi>
                  </dd>
                </>
              )}
              {r.data.clinic && (
                <>
                  <dt className="text-muted">{tt('verify.clinic')}</dt>
                  <dd className="col-span-2">
                    <Bdi>{r.data.clinic}</Bdi>
                  </dd>
                </>
              )}
            </dl>
          </>
        ) : (
          <Alert tone="danger">{tt('rx.verifyInvalid')}</Alert>
        )}
        <p className="text-xs text-muted">{tt('verify.note')}</p>
      </Card>
    </div>
  );
}
