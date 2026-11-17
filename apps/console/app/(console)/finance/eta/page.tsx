'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Select, Stat, Table } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';

const STATUSES = ['queued', 'submitted', 'valid', 'invalid', 'failed'] as const;
type Status = (typeof STATUSES)[number];

interface Receipt {
  id: string;
  clinic_id: string;
  bill_id: string;
  receipt_number: string;
  uuid: string | null;
  status: Status;
  attempts: number;
  errors: unknown;
  submitted_at: string | null;
  created_at: string;
}

const TONE: Record<Status, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = { queued: 'neutral', submitted: 'primary', valid: 'success', invalid: 'danger', failed: 'warning' };

function errorText(e: unknown): string {
  if (!e) return '';
  if (typeof e === 'string') return e;
  const o = e as { message?: unknown; details?: unknown };
  if (typeof o.message === 'string') return o.message;
  return JSON.stringify(e).slice(0, 300);
}

/** FR-BIL-10 Egyptian Tax Authority e-receipt submission status, with manual retry of failed or rejected receipts. */
export default function EtaPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const q = useApi<{ summary: { status: Status; n: number }[]; receipts: Receipt[] }>(`/eta/receipts${qs({ status })}`);
  const a = useAction();
  const count = (s: Status) => q.data?.summary.find((x) => x.status === s)?.n ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('nav.eta')}
        subtitle={t('eta.subtitle')}
        actions={
          can('settings:view') && (
            <Link href="/admin/entities" className="inline-flex h-10 items-center rounded-xl border border-border px-4 hover:bg-bg">
              {t('eta.credentials')}
            </Link>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUSES.map((s) => (
          <Stat key={s} label={t(`eta.status.${s}`)} value={count(s)} />
        ))}
      </div>
      <Section
        title={t('eta.receipts')}
        actions={
          <>
            <Select className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
              <option value="">{t('cash.allStatuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`eta.status.${s}`)}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={q.reload}>
              {t('common.refresh')}
            </Button>
          </>
        }
      >
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data?.receipts} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('eta.receipt')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('eta.attempts')}</th>
                  <th>{t('eta.submittedAt')}</th>
                  <th>{t('eta.errors')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="underline" href={`/cashier/bills/${r.bill_id}`}>
                        <Bdi className="num">{r.receipt_number}</Bdi>
                      </Link>
                      <span className="block text-xs text-muted">
                        <DateText value={r.created_at} locale={locale} withTime />
                      </span>
                      {r.uuid && <Bdi className="num block max-w-40 truncate text-xs text-muted">{r.uuid}</Bdi>}
                    </td>
                    <td>
                      <Badge tone={TONE[r.status]}>{t(`eta.status.${r.status}`)}</Badge>
                    </td>
                    <td className="num">{r.attempts}</td>
                    <td>{r.submitted_at ? <DateText value={r.submitted_at} locale={locale} withTime /> : '—'}</td>
                    <td className="max-w-xs text-xs">
                      <bdi dir="ltr" className="break-words">
                        {errorText(r.errors)}
                      </bdi>
                    </td>
                    <td>
                      {can('bill:approve') && (r.status === 'failed' || r.status === 'invalid') && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={a.busy}
                          onClick={async () => {
                            const x = await a.run(() => post(`/eta/receipts/${r.id}/retry`));
                            if (x) {
                              toast(t('eta.requeued'));
                              q.reload();
                            }
                          }}
                        >
                          {t('common.retry')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
        <p className="mt-2 text-xs text-muted">{t('eta.hint')}</p>
      </Section>
    </div>
  );
}
