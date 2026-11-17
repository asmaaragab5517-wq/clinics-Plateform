'use client';

import { useState } from 'react';
import { SERVICE_TYPES, formatMoney } from '@hf/shared';
import { Alert, Badge, Bdi, Button, PageHeader, Table } from '@hf/ui';
import { Check, DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import type { Payer } from '@/components/insurance';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post } from '@/lib/api';
import { useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName, num, parseEgp } from '@/lib/format';

/** FR-BIL-11 insurance administration: payers (insurers, TPAs, corporates) and their plans. */
export default function InsurancePage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const q = useApi<Payer[]>('/insurance/payers');
  const edit = can('settings:edit');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.insurance')} subtitle={t('insAdmin.subtitle')} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t('insAdmin.payers')} className="xl:col-span-2">
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <div className="flex flex-col gap-4">
                {rows.map((p) => (
                  <article key={p.id} className="rounded-xl border border-border p-3">
                    <header className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="font-bold">{biName(p, locale)}</h3>
                      <Bdi className="num text-xs text-muted">{p.code}</Bdi>
                      <Badge>{t(`insAdmin.kind.${p.kind}`)}</Badge>
                      {!p.is_active && <Badge tone="danger">{t('common.inactive')}</Badge>}
                    </header>
                    {p.plans.length === 0 ? (
                      <p className="text-sm text-muted">{t('insAdmin.noPlans')}</p>
                    ) : (
                      <Table>
                        <thead>
                          <tr>
                            <th>{t('ins.plan')}</th>
                            <th>{t('insAdmin.coverage')}</th>
                            <th>{t('insAdmin.copay')}</th>
                            <th>{t('insAdmin.overrides')}</th>
                            <th>{t('insAdmin.annualLimit')}</th>
                            <th>{t('ins.needsApproval')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.plans.map((pl) => (
                            <tr key={pl.id}>
                              <td>
                                {pl.name} {!pl.is_active && <Badge tone="danger">{t('common.inactive')}</Badge>}
                              </td>
                              <td className="num">{`${Number(pl.coverage_percent)}%`}</td>
                              <td className="num">{formatMoney(num(pl.copay_fixed), locale)}</td>
                              <td className="text-xs">
                                {Object.entries(pl.type_overrides ?? {})
                                  .map(([k, v]) => `${t(`svcType.${k}`)} ${v}%`)
                                  .join(t('common.listSep')) || '—'}
                                {pl.excluded_service_ids?.length > 0 && <span className="block text-muted">{t('insAdmin.excludedN', { n: pl.excluded_service_ids.length })}</span>}
                              </td>
                              <td className="num">{pl.annual_limit ? formatMoney(num(pl.annual_limit), locale) : '—'}</td>
                              <td>{pl.requires_approval ? t('common.yes') : t('common.no')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </article>
                ))}
              </div>
            )}
          </DataState>
          {!edit && <p className="mt-2 text-xs text-muted">{t('insAdmin.readOnly')}</p>}
          <p className="mt-2 text-xs text-muted">{t('insAdmin.noEditGap')}</p>
        </Section>
        {edit && (
          <div className="flex flex-col gap-4">
            <NewPayer onDone={q.reload} />
            <NewPlan payers={q.data ?? []} onDone={q.reload} />
          </div>
        )}
      </div>
    </div>
  );
}

function NewPayer({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const blank = { code: '', nameAr: '', nameEn: '', kind: 'insurer', phone: '', email: '' };
  const [f, setF] = useState(blank);
  const a = useAction();
  return (
    <Section title={t('insAdmin.newPayer')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const contact: Record<string, string> = {};
          if (f.phone.trim()) contact.phone = f.phone.trim();
          if (f.email.trim()) contact.email = f.email.trim();
          const r = await a.run(() => post('/insurance/payers', { code: f.code.trim().toUpperCase(), nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim(), kind: f.kind, contact }));
          if (r) {
            toast(t('common.saved'));
            setF(blank);
            onDone();
          }
        }}
      >
        <TextField label={t('insAdmin.code')} hint={t('insAdmin.codeHint')} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required pattern="[A-Z0-9_\-]{2,20}" dir="ltr" />
        <TextField label={t('cat.nameAr')} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} required minLength={2} dir="rtl" />
        <TextField label={t('cat.nameEn')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" />
        <SelectField label={t('insAdmin.kindLabel')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={['insurer', 'tpa', 'corporate'].map((k) => ({ value: k, label: t(`insAdmin.kind.${k}`) }))} />
        <div className="grid grid-cols-2 gap-2">
          <TextField label={t('insAdmin.phone')} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" />
          <TextField label={t('pat.email')} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" />
        </div>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('insAdmin.addPayer')}
        </Button>
      </form>
    </Section>
  );
}

function NewPlan({ payers, onDone }: { payers: Payer[]; onDone: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { active: services } = useServices();
  const blank = { payerId: '', name: '', coveragePercent: '80', copay: '0', annualLimit: '', requiresApproval: false };
  const [f, setF] = useState(blank);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const a = useAction();
  return (
    <Section title={t('insAdmin.newPlan')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const pct = Number(f.coveragePercent);
          const copay = parseEgp(f.copay || '0');
          const limit = f.annualLimit.trim() ? parseEgp(f.annualLimit) : null;
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) return a.setError(t('insAdmin.percentRule'));
          if (copay === null || (f.annualLimit.trim() && !limit)) return a.setError(t('form.invalidAmount'));
          const typeOverrides: Record<string, number> = {};
          for (const [k, v] of Object.entries(overrides)) {
            if (v.trim() === '') continue;
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0 || n > 100) return a.setError(t('insAdmin.percentRule'));
            typeOverrides[k] = n;
          }
          const r = await a.run(() =>
            post('/insurance/plans', { payerId: f.payerId, name: f.name.trim(), coveragePercent: pct, copayFixed: copay, typeOverrides, excludedServiceIds: excluded, requiresApproval: f.requiresApproval, annualLimit: limit ?? undefined }),
          );
          if (r) {
            toast(t('common.saved'));
            setF(blank);
            setOverrides({});
            setExcluded([]);
            onDone();
          }
        }}
      >
        <SelectField label={t('ins.payer')} value={f.payerId} required placeholder={t('form.choose')} onChange={(e) => setF({ ...f, payerId: e.target.value })} options={payers.map((p) => ({ value: p.id, label: biName(p, locale) }))} />
        <TextField label={t('insAdmin.planName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} dir="auto" />
        <div className="grid grid-cols-2 gap-2">
          <TextField label={t('insAdmin.coveragePercent')} type="number" min={0} max={100} step="0.01" value={f.coveragePercent} onChange={(e) => setF({ ...f, coveragePercent: e.target.value })} required dir="ltr" />
          <TextField label={t('insAdmin.copayEgp')} value={f.copay} onChange={(e) => setF({ ...f, copay: e.target.value })} inputMode="decimal" dir="ltr" />
        </div>
        <TextField label={t('insAdmin.annualLimitEgp')} value={f.annualLimit} onChange={(e) => setF({ ...f, annualLimit: e.target.value })} inputMode="decimal" dir="ltr" hint={t('insAdmin.annualLimitHint')} />
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-2">
          <legend className="px-1 text-sm font-medium">{t('insAdmin.overrides')}</legend>
          <p className="text-xs text-muted">{t('insAdmin.overridesHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            {SERVICE_TYPES.map((k) => (
              <TextField key={k} label={t(`svcType.${k}`)} type="number" min={0} max={100} value={overrides[k] ?? ''} onChange={(e) => setOverrides({ ...overrides, [k]: e.target.value })} dir="ltr" />
            ))}
          </div>
        </fieldset>
        <details className="rounded-xl border border-border p-2 text-sm">
          <summary className="cursor-pointer font-medium">{t('insAdmin.excluded', { n: excluded.length })}</summary>
          <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto">
            {services.map((s) => (
              <Check key={s.id} label={`${s.code} · ${biName(s, locale)}`} checked={excluded.includes(s.id)} onChange={(v) => setExcluded(v ? [...excluded, s.id] : excluded.filter((x) => x !== s.id))} />
            ))}
          </div>
        </details>
        <Check label={t('insAdmin.requiresApproval')} checked={f.requiresApproval} onChange={(v) => setF({ ...f, requiresApproval: v })} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy || !f.payerId}>
          {t('insAdmin.addPlan')}
        </Button>
      </form>
    </Section>
  );
}
