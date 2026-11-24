'use client';

import { formatMoney } from '@hf/shared/money';
import { Alert, Badge, PageHeader, Table } from '@hf/ui';
import { Gauge } from '@/components/charts';
import { DataState, Section } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useApi } from '@/lib/hooks';
import { biName, isoDate, num } from '@/lib/format';

interface Subscription {
  subscription: { plan_code: string; status: 'trial' | 'active' | 'past_due' | 'cancelled'; current_period_end: string; limits: Record<string, number>; name_ar: string; name_en: string } | null;
  usage: { clinics: number; staff: number; sms_this_month: number; storage_bytes: number | string };
}

interface Invoice {
  id: string;
  period_start: string;
  period_end: string;
  plan_code: string;
  amount: number;
  usage: { smsSegments?: number; smsOverage?: number };
  status: 'open' | 'paid' | 'void';
  checkout_url: string | null;
  paid_at: string | null;
}

const GB = 1024 ** 3;

/** BR-20 organisation subscription: plan, limits against current usage, and platform invoices with HealthPay links. */
export default function SubscriptionPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const q = useApi<Subscription>('/subscription');
  const inv = useApi<Invoice[]>(can('settings:view') ? '/subscription/invoices' : null);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.subscription')} />
      <DataState loading={q.loading} error={q.error} data={q.data}>
        {(d) =>
          !d.subscription ? (
            <Alert tone="info">{t('sub.none')}</Alert>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              <Section title={t('sub.plan')}>
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">{t('sub.plan')}</dt>
                    <dd className="font-bold">{biName(d.subscription, locale)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t('common.status')}</dt>
                    <dd>
                      <Badge tone={d.subscription.status === 'active' ? 'success' : d.subscription.status === 'trial' ? 'primary' : 'danger'}>{t(`sub.status.${d.subscription.status}`)}</Badge>
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t('sub.periodEnd')}</dt>
                    <dd className="num">{isoDate(d.subscription.current_period_end)}</dd>
                  </div>
                </dl>
                {d.subscription.status === 'past_due' && <div className="mt-3"><Alert tone="danger">{t('sub.pastDue')}</Alert></div>}
                <p className="mt-3 text-xs text-muted">{t('sub.changePlan')}</p>
              </Section>
              <Section title={t('sub.limits')} className="xl:col-span-2">
                <ul className="grid gap-4 md:grid-cols-2">
                  {(
                    [
                      ['clinics', num(d.usage.clinics), d.subscription.limits.clinics, (v: number) => String(v)],
                      ['staff', num(d.usage.staff), d.subscription.limits.staff, (v: number) => String(v)],
                      ['sms', num(d.usage.sms_this_month), d.subscription.limits.smsPerMonth, (v: number) => v.toLocaleString('en')],
                      ['storage', num(d.usage.storage_bytes) / GB, d.subscription.limits.storageGb, (v: number) => `${v.toFixed(v < 10 ? 2 : 0)} GB`],
                    ] as const
                  ).map(([k, used, limit, fmt]) => {
                    const pct = limit ? Math.round((used / limit) * 1000) / 10 : 0;
                    return (
                      <li key={k} className="flex flex-col gap-1 text-sm">
                        <div className="flex justify-between">
                          <span>{t(`sub.limit.${k}`)}</span>
                          <span className="num">{limit ? t('sub.ofLimit', { used: fmt(used), limit: fmt(limit) }) : fmt(used)}</span>
                        </div>
                        {limit ? <Gauge label={t(`sub.limit.${k}`)} percent={pct} /> : null}
                        {pct >= 90 && <span className="text-xs text-danger">{t('sub.nearLimit')}</span>}
                      </li>
                    );
                  })}
                </ul>
                {d.subscription.limits.smsOveragePrice ? <p className="mt-3 text-xs text-muted">{t('sub.overage', { price: formatMoney(d.subscription.limits.smsOveragePrice, locale) })}</p> : null}
              </Section>
            </div>
          )
        }
      </DataState>
      {can('settings:view') && (
        <Section title={t('sub.invoices')}>
          <DataState loading={inv.loading} error={inv.error} data={inv.data} empty={(x) => x.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('sub.period')}</th>
                    <th>{t('sub.plan')}</th>
                    <th>{t('sub.smsOverage')}</th>
                    <th>{t('common.total')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td className="num">
                        {isoDate(i.period_start)} → {isoDate(i.period_end)}
                      </td>
                      <td>{i.plan_code}</td>
                      <td className="num text-xs">
                        {t('sub.segments', { n: num(i.usage?.smsSegments) })} · {formatMoney(num(i.usage?.smsOverage), locale)}
                      </td>
                      <td className="num">{formatMoney(num(i.amount), locale)}</td>
                      <td>
                        <Badge tone={i.status === 'paid' ? 'success' : i.status === 'void' ? 'neutral' : 'warning'}>{t(`sub.inv.${i.status}`)}</Badge>
                        {i.paid_at && <span className="num block text-xs text-muted">{isoDate(i.paid_at)}</span>}
                      </td>
                      <td>
                        {i.status === 'open' && i.checkout_url && (
                          <a href={i.checkout_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-xl bg-primary px-3 text-sm font-medium text-primary-fg hover:opacity-90">
                            {t('sub.pay')}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </DataState>
        </Section>
      )}
    </div>
  );
}
