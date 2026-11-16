'use client';

import { useMemo, useState } from 'react';
import { addDays, formatMoney, localDate } from '@hf/shared';
import { Button, PageHeader, Select, Stat } from '@hf/ui';
import { DataState, FileLink, TextField } from '@/components/common';
import { Gauge, HBarChart, StackedBar } from '@/components/charts';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { num, todayCairo } from '@/lib/format';

interface Dashboard {
  appointments: { byStatus: Record<string, number>; byChannel: Record<string, number>; total: number };
  noShowRate: number;
  utilisation: { capacity: number; booked: number; percent: number };
  wait: { avg_wait_min: number | string | null; avg_consult_min: number | string | null; n: number };
  revenue: { gross: number | string; discount: number | string; vat: number | string; net: number | string; total: number | string; bills: number };
  payments: { method: string; amount: number | string; refunded: number | string; n: number }[];
  refunds: { amount: number; n: number };
  outstanding: { amount: number | string; bills: number };
  patients: { new: number; returning: number };
  ratings: { avg: string | number | null; count: number; low: number };
  topServices: { service_id: string | null; name_ar: string | null; name_en: string | null; net: number | string; bills: number }[];
  topDiagnoses: { code: string; title_ar: string | null; title_en: string | null; n: number }[];
  sms: { cost: number; segments: number; messages: number };
}

type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';

function rangeFor(p: Preset, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: monthStart, to: today };
    case 'lastMonth': {
      const lastEnd = addDays(monthStart, -1);
      return { from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
    }
    default:
      return { from: addDays(today, -6), to: today };
  }
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { clinicId, me, can } = useSession();
  const today = todayCairo();
  const [preset, setPreset] = useState<Preset>('7d');
  const [custom, setCustom] = useState(rangeFor('7d', today));
  const [scope, setScope] = useState<'clinic' | 'all'>(me.network ? 'all' : 'clinic');
  const range = preset === 'custom' ? custom : rangeFor(preset, today);
  const cid = scope === 'clinic' ? clinicId : undefined;
  const path = range.from <= range.to ? `/reports/dashboard${qs({ from: range.from, to: range.to, clinicId: cid })}` : null;
  const { data, loading, error, reload } = useApi<Dashboard>(path);
  const money = (v: unknown) => formatMoney(num(v), locale);

  const presets: { v: Preset; k: string }[] = [
    { v: 'today', k: 'dash.today' },
    { v: '7d', k: 'dash.last7' },
    { v: '30d', k: 'dash.last30' },
    { v: 'month', k: 'dash.thisMonth' },
    { v: 'lastMonth', k: 'dash.lastMonth' },
    { v: 'custom', k: 'dash.custom' },
  ];

  const exportQs = useMemo(() => ({ from: range.from, to: range.to, clinicId: cid }), [range.from, range.to, cid]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('report.dashboard')}
        subtitle={t('dash.range', { from: range.from, to: range.to })}
        actions={
          can('report:export') ? (
            <>
              <FileLink href={`/reports/export${qs({ report: 'revenue-by-service', format: 'xlsx', ...exportQs })}`}>{t('dash.exportRevenueXlsx')}</FileLink>
              <FileLink href={`/reports/export${qs({ report: 'revenue-by-service', format: 'csv', ...exportQs })}`}>{t('dash.exportRevenueCsv')}</FileLink>
              <FileLink href={`/reports/export${qs({ report: 'daily-appointments', format: 'pdf', date: range.to, clinicId: cid })}`}>{t('dash.exportDailyPdf')}</FileLink>
              <FileLink href={`/reports/export${qs({ report: 'outstanding', format: 'csv', clinicId: cid })}`}>{t('dash.exportOutstanding')}</FileLink>
            </>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-2" role="toolbar" aria-label={t('dash.filters')}>
        {presets.map((p) => (
          <Button key={p.v} size="sm" variant={preset === p.v ? 'primary' : 'secondary'} onClick={() => setPreset(p.v)} aria-pressed={preset === p.v}>
            {t(p.k)}
          </Button>
        ))}
        {preset === 'custom' && (
          <>
            <div className="w-40">
              <TextField label={t('common.from')} type="date" value={custom.from} max={today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </div>
            <div className="w-40">
              <TextField label={t('common.to')} type="date" value={custom.to} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </div>
          </>
        )}
        <div className="w-48">
          <Select aria-label={t('dash.scope')} value={scope} onChange={(e) => setScope(e.target.value as 'clinic' | 'all')} className="h-8">
            <option value="clinic">{t('dash.scopeClinic')}</option>
            {me.network && <option value="all">{t('dash.scopeAll')}</option>}
          </Select>
        </div>
        <Button size="sm" variant="ghost" onClick={reload}>
          {t('common.refresh')}
        </Button>
      </div>
      <DataState loading={loading} error={error} data={data}>
        {(d) => (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Stat label={t('dash.appointments')} value={d.appointments.total} />
              <Stat label={t('report.noShowRate')} value={`${d.noShowRate}%`} hint={<Gauge label={t('report.noShowRate')} percent={d.noShowRate} />} />
              <Stat label={t('report.utilisation')} value={`${d.utilisation.percent}%`} hint={<Gauge label={t('report.utilisation')} percent={d.utilisation.percent} />} />
              <Stat label={t('report.avgWait')} value={d.wait.avg_wait_min === null ? '—' : t('dash.minutes', { n: num(d.wait.avg_wait_min) })} />
              <Stat label={t('dash.avgConsult')} value={d.wait.avg_consult_min === null ? '—' : t('dash.minutes', { n: num(d.wait.avg_consult_min) })} />
              <Stat label={t('dash.rating')} value={d.ratings.avg === null ? '—' : num(d.ratings.avg).toFixed(2)} hint={t('dash.ratingHint', { count: d.ratings.count, low: d.ratings.low })} />
              <Stat label={t('dash.gross')} value={money(d.revenue.gross)} />
              <Stat label={t('bill.discount')} value={money(d.revenue.discount)} />
              <Stat label={t('bill.vat')} value={money(d.revenue.vat)} />
              <Stat label={t('dash.net')} value={money(d.revenue.net)} hint={t('dash.bills', { n: d.revenue.bills })} />
              <Stat label={t('dash.refunds')} value={money(d.refunds.amount)} hint={t('dash.count', { n: d.refunds.n })} />
              <Stat label={t('dash.outstanding')} value={money(d.outstanding.amount)} hint={t('dash.bills', { n: d.outstanding.bills })} />
              <Stat label={t('dash.smsCost')} value={money(d.sms.cost)} hint={t('dash.smsHint', { messages: d.sms.messages, segments: d.sms.segments })} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <HBarChart title={t('dash.byStatus')} data={Object.entries(d.appointments.byStatus).map(([k, v]) => ({ label: t(`status.${k}`), value: num(v) }))} />
              <HBarChart title={t('dash.byChannel')} data={Object.entries(d.appointments.byChannel).map(([k, v]) => ({ label: t(`channel.${k}`), value: num(v) }))} />
              <HBarChart title={t('dash.paymentsByMethod')} data={d.payments.map((p) => ({ label: t(`method.${p.method}`), value: num(p.amount), display: money(p.amount) }))} />
              <StackedBar
                title={t('dash.newVsReturning')}
                data={[
                  { label: t('dash.new'), value: num(d.patients.new) },
                  { label: t('dash.returning'), value: num(d.patients.returning) },
                ]}
              />
              <HBarChart title={t('dash.topServices')} data={d.topServices.map((s) => ({ label: (locale === 'en' ? s.name_en || s.name_ar : s.name_ar) ?? t('dash.other'), value: num(s.net), display: money(s.net) }))} />
              <HBarChart title={t('dash.topDiagnoses')} data={d.topDiagnoses.map((x) => ({ label: `${x.code} ${(locale === 'ar' ? x.title_ar : x.title_en) ?? x.title_en ?? ''}`.trim(), value: num(x.n) }))} />
            </div>
            <p className="text-xs text-muted">{t('dash.sqlNote', { at: localDate(new Date()) })}</p>
          </>
        )}
      </DataState>
    </div>
  );
}
