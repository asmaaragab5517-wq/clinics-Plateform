'use client';

import { useState } from 'react';
import { formatMoney } from '@hf/shared/money';
import { Alert, Badge, Button, PageHeader, Select, Table } from '@hf/ui';
import { DataState, Section, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useToast } from '@/components/toast';
import { pPost, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, isoDate, num, todayCairo } from '@/lib/format';
import type { PlatformInvoice, PlatformOrg } from '@/lib/platform-types';

function lastMonth(): string {
  const [y, m] = todayCairo().split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Monthly platform invoices (plan + SMS overage) with a HealthPay checkout link per organisation. */
export default function PlatformInvoicesPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [org, setOrg] = useState('');
  const [month, setMonth] = useState(lastMonth());
  const orgs = useApi<PlatformOrg[]>('/organisations', true);
  const q = useApi<PlatformInvoice[]>(`/invoices${qs({ organisationId: org })}`, true);
  const a = useAction();
  const orgName = (id: string) => {
    const o = orgs.data?.find((x) => x.id === id);
    return o ? biName(o, locale) : id.slice(0, 8);
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('plat.nav.invoices')} />
      <Section title={t('plat.inv.generate')}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await a.run(() => pPost<PlatformInvoice[]>('/invoices/generate', { month }));
            if (r) {
              toast(t('plat.inv.generated', { n: r.length }));
              q.reload();
            }
          }}
        >
          <div className="w-48">
            <TextField label={t('plat.inv.month')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} required pattern="\d{4}-\d{2}" dir="ltr" />
          </div>
          <Button type="submit" disabled={a.busy}>
            {t('plat.inv.generateBtn')}
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted">{t('plat.inv.hint')}</p>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
      </Section>
      <Section
        title={t('sub.invoices')}
        actions={
          <Select className="h-8 w-56" value={org} onChange={(e) => setOrg(e.target.value)} aria-label={t('plat.orgs.org')}>
            <option value="">{t('plat.inv.allOrgs')}</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {biName(o, locale)}
              </option>
            ))}
          </Select>
        }
      >
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('plat.orgs.org')}</th>
                  <th>{t('sub.period')}</th>
                  <th>{t('sub.plan')}</th>
                  <th>{t('sub.smsOverage')}</th>
                  <th>{t('common.total')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('plat.inv.checkout')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td>{orgName(i.organisation_id)}</td>
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
                      {i.checkout_url ? (
                        <a className="text-sm underline" href={i.checkout_url} target="_blank" rel="noopener noreferrer">
                          {t('plat.inv.link')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
    </div>
  );
}
