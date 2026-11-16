'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, Money, PageHeader, Table, Tabs } from '@hf/ui';
import { DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post, qs } from '@/lib/api';
import { useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName, isoDate, num, parseEgp, todayCairo } from '@/lib/format';
import type { DoctorRow } from '@/lib/types';

type Rule = { kind: 'percent'; percent: number } | { kind: 'fixed'; amount: number } | { kind: 'tiered'; tiers: { upTo: number | null; percent: number }[] };
type Tab = 'statements' | 'rules';

/** FR-STF-3: commission rules per doctor/clinic/service and monthly statements approved by the Accountant. */
export default function CommissionPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('statements');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.commission')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'statements', label: t('comm.statements') },
          { value: 'rules', label: t('comm.rules') },
        ]}
      />
      {tab === 'statements' ? <Statements /> : <Rules />}
    </div>
  );
}

function Statements() {
  const { t, locale } = useI18n();
  const { can, me } = useSession();
  const toast = useToast();
  const [month, setMonth] = useState(todayCairo().slice(0, 7));
  const q = useApi<{ id: string; doctor_name: string; clinic_id: string | null; month: string; revenue: number; share: number; status: string }[]>(`/commission-statements${qs({ month })}`);
  const a = useAction();
  return (
    <Section
      title={t('comm.statements')}
      actions={
        <>
          <input type="month" className="h-8 rounded-xl border border-border bg-surface px-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t('comm.month')} />
          {can('commission:create') && (
            <Button size="sm" variant="secondary" onClick={() => void a.run(() => post('/commission-statements/generate', { month })).then((r) => r && (toast(t('comm.generated')), q.reload()))}>
              {t('comm.generate')}
            </Button>
          )}
        </>
      }
    >
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('book.doctor')}</th>
                <th>{t('shell.clinic')}</th>
                <th>{t('comm.month')}</th>
                <th>{t('comm.revenue')}</th>
                <th>{t('comm.share')}</th>
                <th>{t('common.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Bdi>{s.doctor_name}</Bdi>
                  </td>
                  <td>{biName(me.clinics.find((c) => c.id === s.clinic_id), locale)}</td>
                  <td className="num">{isoDate(s.month).slice(0, 7)}</td>
                  <td>
                    <Money value={num(s.revenue)} locale={locale} />
                  </td>
                  <td>
                    <Money value={num(s.share)} locale={locale} />
                  </td>
                  <td>
                    <Badge tone={s.status === 'approved' ? 'success' : 'neutral'}>{t(`comm.status.${s.status}`)}</Badge>
                  </td>
                  <td>
                    {s.status === 'draft' && can('commission:approve') && (
                      <Button size="sm" onClick={() => void a.run(() => post(`/commission-statements/${s.id}/approve`)).then((r) => r && q.reload())}>
                        {t('common.approve')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </DataState>
    </Section>
  );
}

function Rules() {
  const { t, locale } = useI18n();
  const { can, me } = useSession();
  const toast = useToast();
  const doctors = useApi<DoctorRow[]>('/doctors');
  const rules = useApi<{ id: string; doctor_id: string; clinic_id: string | null; service_id: string | null; service_type: string | null; rule: Rule; effective_from: string }[]>('/commission-rules');
  const { services } = useServices();
  const [f, setF] = useState({ doctorId: '', clinicId: '', serviceId: '', kind: 'percent', percent: '30', amount: '', tiers: '50000:20, :30', effectiveFrom: todayCairo() });
  const a = useAction();
  const describe = (r: Rule) =>
    r.kind === 'percent' ? `${r.percent}%` : r.kind === 'fixed' ? `${(r.amount / 100).toFixed(2)}` : r.tiers.map((x) => `${x.upTo === null ? '∞' : (x.upTo / 100).toFixed(0)} → ${x.percent}%`).join(' · ');
  function buildRule(): Rule | null {
    if (f.kind === 'percent') return { kind: 'percent', percent: Number(f.percent) };
    if (f.kind === 'fixed') {
      const p = parseEgp(f.amount);
      return p === null ? null : { kind: 'fixed', amount: p };
    }
    const tiers = f.tiers.split(',').map((s) => {
      const [up, pct] = s.split(':').map((x) => x.trim());
      return { upTo: up ? parseEgp(up) : null, percent: Number(pct) };
    });
    return tiers.every((x) => Number.isFinite(x.percent)) ? { kind: 'tiered', tiers } : null;
  }
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('comm.rules')} className="xl:col-span-2">
        <DataState loading={rules.loading} error={rules.error} data={rules.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('book.doctor')}</th>
                  <th>{t('shell.clinic')}</th>
                  <th>{t('book.service')}</th>
                  <th>{t('comm.rule')}</th>
                  <th>{t('sch.from')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Bdi>{biName(doctors.data?.find((d) => d.id === r.doctor_id), locale)}</Bdi>
                    </td>
                    <td>{r.clinic_id ? biName(me.clinics.find((c) => c.id === r.clinic_id), locale) : t('comm.any')}</td>
                    <td>{r.service_id ? biName(services.find((s) => s.id === r.service_id), locale) : r.service_type ? t(`svcType.${r.service_type}`) : t('comm.any')}</td>
                    <td className="num">
                      {t(`comm.kind.${r.rule.kind}`)} · {describe(r.rule)}
                    </td>
                    <td className="num">{isoDate(r.effective_from)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      {can('commission:edit') && (
        <Section title={t('comm.newRule')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const rule = buildRule();
              if (!rule) return a.setError(t('err.validation_failed'));
              const r = await a.run(() => post('/commission-rules', { doctorId: f.doctorId, clinicId: f.clinicId || undefined, serviceId: f.serviceId || undefined, rule, effectiveFrom: f.effectiveFrom }));
              if (r) {
                toast(t('common.saved'));
                rules.reload();
              }
            }}
          >
            <SelectField label={t('book.doctor')} value={f.doctorId} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, doctorId: e.target.value })} options={(doctors.data ?? []).map((d) => ({ value: d.id, label: biName(d, locale) }))} required />
            <SelectField label={t('shell.clinic')} value={f.clinicId} placeholder={t('comm.any')} onChange={(e) => setF({ ...f, clinicId: e.target.value })} options={me.clinics.map((c) => ({ value: c.id, label: biName(c, locale) }))} />
            <SelectField label={t('book.service')} value={f.serviceId} placeholder={t('comm.any')} onChange={(e) => setF({ ...f, serviceId: e.target.value })} options={services.map((s) => ({ value: s.id, label: biName(s, locale) }))} />
            <SelectField label={t('comm.rule')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={['percent', 'fixed', 'tiered'].map((k) => ({ value: k, label: t(`comm.kind.${k}`) }))} />
            {f.kind === 'percent' && <TextField label={t('comm.percent')} type="number" min={0} max={100} value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} />}
            {f.kind === 'fixed' && <TextField label={t('comm.amount')} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} dir="ltr" />}
            {f.kind === 'tiered' && <TextField label={t('comm.tiers')} hint={t('comm.tiersHint')} value={f.tiers} onChange={(e) => setF({ ...f, tiers: e.target.value })} dir="ltr" />}
            <TextField label={t('sch.from')} type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy}>
              {t('common.save')}
            </Button>
          </form>
        </Section>
      )}
    </div>
  );
}
