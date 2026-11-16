'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, Money, PageHeader, Select, Table } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { num } from '@/lib/format';

interface Refund {
  id: string;
  amount: number;
  reason: string;
  status: string;
  created_at: string;
  payment_method: string;
  receipt_number: string | null;
  patient_name: string;
  requested_by: string | null;
}

/** FR-BIL-5: request → approval (Accountant/Manager, four-eyes) → execution (cash from the open shift). */
export default function RefundsPage() {
  const { t, locale } = useI18n();
  const { can, me } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState('requested');
  const q = useApi<Refund[]>(`/refunds${qs({ status: status || undefined })}`);
  const a = useAction();
  const [ref, setRef] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.refunds')} />
      <Section
        title={t('nav.refunds')}
        actions={
          <Select className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
            <option value="">{t('cash.allStatuses')}</option>
            {['requested', 'approved', 'rejected', 'processing', 'completed', 'failed'].map((s) => (
              <option key={s} value={s}>
                {t(`refundStatus.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('rec.patient')}</th>
                  <th>{t('cash.receiptNo')}</th>
                  <th>{t('cash.method')}</th>
                  <th>{t('cash.amount')}</th>
                  <th>{t('form.reason')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <DateText value={r.created_at} locale={locale} withTime />
                    </td>
                    <td>
                      <Bdi>{r.patient_name}</Bdi>
                    </td>
                    <td>
                      <Bdi className="num">{r.receipt_number ?? '—'}</Bdi>
                    </td>
                    <td>{t(`method.${r.payment_method}`)}</td>
                    <td>
                      <Money value={num(r.amount)} locale={locale} />
                    </td>
                    <td dir="auto" className="max-w-xs truncate">
                      {r.reason}
                    </td>
                    <td>
                      <Badge>{t(`refundStatus.${r.status}`)}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.status === 'requested' && can('refund:approve') && r.requested_by !== me.userId && (
                          <>
                            <Button size="sm" onClick={() => void a.run(() => post(`/refunds/${r.id}/decision`, { approve: true })).then((x) => x && (toast(t('common.saved')), q.reload()))}>
                              {t('common.approve')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void a.run(() => post(`/refunds/${r.id}/decision`, { approve: false })).then((x) => x && q.reload())}>
                              {t('common.reject')}
                            </Button>
                          </>
                        )}
                        {r.status === 'approved' && can('refund:create') && r.payment_method !== 'healthpay' && (
                          <>
                            {r.payment_method !== 'cash' && <input className="h-8 w-28 rounded-lg border border-border bg-surface px-2 text-xs" placeholder={t('cash.reference')} aria-label={t('cash.reference')} value={ref[r.id] ?? ''} onChange={(e) => setRef({ ...ref, [r.id]: e.target.value })} dir="ltr" />}
                            <Button size="sm" onClick={() => void a.run(() => post(`/refunds/${r.id}/execute`, { reference: ref[r.id] || undefined })).then((x) => x && (toast(t('cash.refundExecuted')), q.reload()))}>
                              {t('cash.execute')}
                            </Button>
                          </>
                        )}
                      </div>
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
