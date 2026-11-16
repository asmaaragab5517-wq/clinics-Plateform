'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatMoney } from '@hf/shared';
import { Alert, Badge, Bdi, Button, DateText, Input, PageHeader, Select, Table } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { num } from '@/lib/format';

interface Approval {
  id: string;
  kind: 'discount' | 'void' | 'refund' | 'shift_variance' | 'break_glass';
  entity_id: string;
  payload: Record<string, unknown>;
  status: string;
  requested_by: string;
  requested_by_name: string;
  created_at: string;
  note: string | null;
}

/** Discounts above threshold, voids and shift variances (four-eyes: you cannot decide your own request). */
export default function ApprovalsPage() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const q = useApi<Approval[]>(`/approvals${qs({ status })}`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const a = useAction();
  const decide = async (x: Approval, approve: boolean) => {
    const r = await a.run(() => post(`/approvals/${x.id}/decision`, { approve, note: notes[x.id] || undefined }));
    if (r) {
      toast(approve ? t('appr.approved') : t('appr.rejected'));
      q.reload();
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.approvals')} />
      <Section
        title={t('nav.approvals')}
        actions={
          <Select className="h-8 w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
            {['pending', 'approved', 'rejected'].map((s) => (
              <option key={s} value={s}>
                {t(`appr.status.${s}`)}
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
                  <th>{t('appr.kind')}</th>
                  <th>{t('appr.requestedBy')}</th>
                  <th>{t('appr.details')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <DateText value={x.created_at} locale={locale} withTime />
                    </td>
                    <td>
                      <Badge tone="warning">{t(`appr.kinds.${x.kind}`)}</Badge>
                    </td>
                    <td>
                      <Bdi>{x.requested_by_name}</Bdi>
                    </td>
                    <td className="text-xs">
                      {(x.kind === 'discount' || x.kind === 'void') && (
                        <Link className="underline" href={`/cashier/bills/${x.entity_id}`}>
                          {t('appr.openBill')}
                        </Link>
                      )}
                      {x.payload.variance !== undefined && <span className="num ms-2">{formatMoney(num(x.payload.variance), locale)}</span>}
                      {typeof x.payload.percent === 'number' && <span className="num ms-2">{`${x.payload.percent}%`}</span>}
                      {typeof x.payload.reason === 'string' && <span className="ms-2" dir="auto">{x.payload.reason}</span>}
                      {x.note && <span className="ms-2 text-muted">{x.note}</span>}
                    </td>
                    <td>
                      {x.status === 'pending' && x.requested_by !== me.userId ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <Input className="h-8 w-36 text-xs" placeholder={t('appr.note')} aria-label={t('appr.note')} value={notes[x.id] ?? ''} onChange={(e) => setNotes({ ...notes, [x.id]: e.target.value })} />
                          <Button size="sm" onClick={() => void decide(x, true)}>
                            {t('common.approve')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void decide(x, false)}>
                            {t('common.reject')}
                          </Button>
                        </div>
                      ) : x.status === 'pending' ? (
                        <span className="text-xs text-muted">{t('appr.ownRequest')}</span>
                      ) : null}
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
