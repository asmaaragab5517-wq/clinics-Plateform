'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Money, PageHeader, Table, Tabs } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { MonthPicker } from '@/components/hr';
import { Adjustments, type PayrollRun } from '@/components/payroll';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { num, todayCairo } from '@/lib/format';
import { RUN_TONE, fmtMonth, prevMonth } from '@/lib/hr';
import { useRouter } from 'next/navigation';

type Tab = 'runs' | 'adjustments';

/** Monthly payroll runs (payroll:view) and the month's adjustments. */
export default function PayrollPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('runs');
  const [month, setMonth] = useState(prevMonth(todayCairo().slice(0, 7)));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.payroll')} subtitle={t('pay.subtitle')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'runs', label: t('pay.runs') },
          { value: 'adjustments', label: t('pay.adjustments') },
        ]}
      />
      {tab === 'runs' ? (
        <Runs />
      ) : (
        <>
          <div className="flex justify-end">
            <MonthPicker value={month} onChange={setMonth} />
          </div>
          <AdjustmentsForMonth month={month} />
        </>
      )}
    </div>
  );
}

function AdjustmentsForMonth({ month }: { month: string }) {
  const runs = useApi<PayrollRun[]>('/payroll/runs');
  const closed = (runs.data ?? []).some((r) => r.month === month && (r.status === 'approved' || r.status === 'paid'));
  return <Adjustments key={month} month={month} closed={closed} />;
}

function Runs() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const router = useRouter();
  const q = useApi<PayrollRun[]>('/payroll/runs');
  const [month, setMonth] = useState(prevMonth(todayCairo().slice(0, 7)));
  const a = useAction();
  return (
    <div className="flex flex-col gap-4">
      {can('payroll:create') && (
        <Section title={t('pay.newRun')}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => post<{ id: string }>('/payroll/runs', { month }));
              if (r) {
                toast(t('pay.created'));
                router.push(`/payroll/runs/${r.id}`);
              }
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('hr.month')}</span>
              <input type="month" className="h-10 rounded-xl border border-border bg-surface px-3" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} required />
            </label>
            <Button type="submit" disabled={a.busy}>
              {t('pay.create')}
            </Button>
            <p className="w-full text-xs text-muted">{t('pay.createHint')}</p>
          </form>
          {a.error && <Alert tone="danger">{a.error}</Alert>}
        </Section>
      )}
      <Section title={t('pay.runs')}>
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('hr.month')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('pay.people')}</th>
                  <th>{t('pay.gross')}</th>
                  <th>{t('pay.net')}</th>
                  <th>{t('pay.employerCost')}</th>
                  <th>{t('pay.warnings')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num font-medium">{fmtMonth(r.month)}</td>
                    <td>
                      <Badge tone={RUN_TONE[r.status]}>{t(`pay.status.${r.status}`)}</Badge>
                    </td>
                    <td className="num">{num(r.totals?.people)}</td>
                    <td>
                      <Money value={num(r.totals?.gross)} locale={locale} />
                    </td>
                    <td>
                      <Money value={num(r.totals?.net)} locale={locale} />
                    </td>
                    <td>
                      <Money value={num(r.totals?.employerCost)} locale={locale} />
                    </td>
                    <td>{(r.warnings ?? []).length > 0 ? <Badge tone="warning">{(r.warnings ?? []).length}</Badge> : '—'}</td>
                    <td>
                      <Link href={`/payroll/runs/${r.id}`} className="text-sm font-medium text-primary hover:underline">
                        {t('pay.open')}
                      </Link>
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
