'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SERVICE_TYPES, formatMoney } from '@hf/shared';
import { Alert, Badge, Bdi, Button, DateText, Input, PageHeader, Table } from '@hf/ui';
import { Check, ConfirmDialog, DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import type { Payer, PayerPlan } from '@/components/insurance';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { patch, post } from '@/lib/api';
import { useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName, egpInput, isoDate, num, parseEgp } from '@/lib/format';

const PAYER_KINDS = ['insurer', 'tpa', 'corporate'] as const;
const PAYER_CODE = /^[A-Z0-9_-]{2,20}$/;

/** Per-service-type coverage inputs → API record; null when a value is out of range. */
function parseOverrides(overrides: Record<string, string>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v.trim() === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    out[k] = n;
  }
  return out;
}

/** FR-BIL-11 insurance administration: payers (insurers, TPAs, corporates) and their plans. */
export default function InsurancePage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const q = useApi<Payer[]>(can('bill:view') ? '/insurance/payers' : null);
  const edit = can('settings:edit');
  const toast = useToast();
  const [editPayer, setEditPayer] = useState<Payer | null>(null);
  const [editPlan, setEditPlan] = useState<PayerPlan | null>(null);
  const a = useAction();
  const setActive = async (path: string, isActive: boolean) => {
    const r = await a.run(() => patch(path, { isActive }));
    if (r) {
      toast(isActive ? t('insAdmin.activated') : t('insAdmin.deactivated'));
      q.reload();
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.insurance')} subtitle={t('insAdmin.subtitle')} />
      {can('patient:edit') && <PendingVerification />}
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
                      {edit && (
                        <span className="ms-auto flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditPayer(p)}>
                            {t('common.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => void setActive(`/insurance/payers/${p.id}`, !p.is_active)}>
                            {p.is_active ? t('ins.deactivate') : t('insAdmin.activate')}
                          </Button>
                        </span>
                      )}
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
                            {edit && <th />}
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
                              {edit && (
                                <td>
                                  <div className="flex flex-wrap gap-1">
                                    <Button size="sm" variant="ghost" onClick={() => setEditPlan(pl)}>
                                      {t('common.edit')}
                                    </Button>
                                    <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => void setActive(`/insurance/plans/${pl.id}`, !pl.is_active)}>
                                      {pl.is_active ? t('ins.deactivate') : t('insAdmin.activate')}
                                    </Button>
                                  </div>
                                </td>
                              )}
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
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          {!edit && <p className="mt-2 text-xs text-muted">{t('insAdmin.readOnly')}</p>}
          {edit && <p className="mt-2 text-xs text-muted">{t('insAdmin.editScope')}</p>}
        </Section>
        {edit && (
          <div className="flex flex-col gap-4">
            <NewPayer onDone={q.reload} />
            <NewPlan payers={q.data ?? []} onDone={q.reload} />
          </div>
        )}
      </div>
      <EditPayerDialog payer={editPayer} onClose={() => setEditPayer(null)} onDone={q.reload} />
      <EditPlanDialog plan={editPlan} onClose={() => setEditPlan(null)} onDone={q.reload} />
    </div>
  );
}

function EditPayerDialog({ payer, onClose, onDone }: { payer: Payer | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={!!payer} onClose={onClose} title={t('insAdmin.editPayer')}>
      {payer && <EditPayerForm key={payer.id} payer={payer} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

function EditPayerForm({ payer, onClose, onDone }: { payer: Payer; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ code: payer.code, kind: payer.kind as string, nameAr: payer.name_ar, nameEn: payer.name_en ?? '', phone: payer.contact?.phone ?? '', email: payer.contact?.email ?? '' });
  const a = useAction();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const contact: Record<string, string> = { ...(payer.contact ?? {}) };
        delete contact.phone;
        delete contact.email;
        if (f.phone.trim()) contact.phone = f.phone.trim();
        if (f.email.trim()) contact.email = f.email.trim();
        const code = f.code.trim().toUpperCase();
        if (!PAYER_CODE.test(code)) return a.setError(t('insAdmin.codeHint'));
        const r = await a.run(() => patch(`/insurance/payers/${payer.id}`, { code, kind: f.kind, nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim(), contact }));
        if (r) {
          toast(t('common.saved'));
          onDone();
          onClose();
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <TextField label={t('insAdmin.code')} hint={t('insAdmin.codeHint')} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required pattern="[A-Z0-9_\-]{2,20}" dir="ltr" />
        <SelectField label={t('insAdmin.kindLabel')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={PAYER_KINDS.map((k) => ({ value: k, label: t(`insAdmin.kind.${k}`) }))} />
      </div>
      {f.code.trim().toUpperCase() !== payer.code && <p className="text-xs text-muted">{t('insAdmin.codeChangeHint')}</p>}
      <TextField label={t('cat.nameAr')} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} required minLength={2} dir="rtl" />
      <TextField label={t('cat.nameEn')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" />
      <div className="grid grid-cols-2 gap-2">
        <TextField label={t('insAdmin.phone')} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" />
        <TextField label={t('pat.email')} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" />
      </div>
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={a.busy}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function EditPlanDialog({ plan, onClose, onDone }: { plan: PayerPlan | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={!!plan} onClose={onClose} title={plan ? t('insAdmin.editPlan', { name: plan.name }) : ''}>
      {plan && <EditPlanForm key={plan.id} plan={plan} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

function EditPlanForm({ plan, onClose, onDone }: { plan: PayerPlan; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    name: plan.name,
    coveragePercent: String(Number(plan.coverage_percent)),
    copay: egpInput(num(plan.copay_fixed)),
    annualLimit: plan.annual_limit ? egpInput(num(plan.annual_limit)) : '',
    requiresApproval: plan.requires_approval,
  });
  const [overrides, setOverrides] = useState<Record<string, string>>(Object.fromEntries(Object.entries(plan.type_overrides ?? {}).map(([k, v]) => [k, String(v)])));
  const [excluded, setExcluded] = useState<string[]>(plan.excluded_service_ids ?? []);
  const a = useAction();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const pct = Number(f.coveragePercent);
        const copay = parseEgp(f.copay || '0');
        const limit = f.annualLimit.trim() ? parseEgp(f.annualLimit) : null;
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) return a.setError(t('insAdmin.percentRule'));
        if (copay === null || (f.annualLimit.trim() && !limit)) return a.setError(t('form.invalidAmount'));
        const typeOverrides = parseOverrides(overrides);
        if (!typeOverrides) return a.setError(t('insAdmin.percentRule'));
        const r = await a.run(() =>
          patch(`/insurance/plans/${plan.id}`, { name: f.name.trim(), coveragePercent: pct, copayFixed: copay, requiresApproval: f.requiresApproval, typeOverrides, excludedServiceIds: excluded, annualLimit: limit }),
        );
        if (r) {
          toast(t('common.saved'));
          onDone();
          onClose();
        }
      }}
    >
      <TextField label={t('insAdmin.planName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} dir="auto" />
      <div className="grid grid-cols-2 gap-2">
        <TextField label={t('insAdmin.coveragePercent')} type="number" min={0} max={100} step="0.01" value={f.coveragePercent} onChange={(e) => setF({ ...f, coveragePercent: e.target.value })} required dir="ltr" />
        <TextField label={t('insAdmin.copayEgp')} value={f.copay} onChange={(e) => setF({ ...f, copay: e.target.value })} inputMode="decimal" dir="ltr" />
      </div>
      <TextField label={t('insAdmin.annualLimitEgp')} value={f.annualLimit} onChange={(e) => setF({ ...f, annualLimit: e.target.value })} inputMode="decimal" dir="ltr" hint={t('insAdmin.annualLimitClearHint')} />
      <PlanRulesFields overrides={overrides} setOverrides={setOverrides} excluded={excluded} setExcluded={setExcluded} />
      <Check label={t('insAdmin.requiresApproval')} checked={f.requiresApproval} onChange={(v) => setF({ ...f, requiresApproval: v })} />
      <p className="text-xs text-muted">{t('insAdmin.planEditHint')}</p>
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={a.busy}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

/** Coverage by service type and excluded services, shared by the new-plan and edit-plan forms. */
function PlanRulesFields({ overrides, setOverrides, excluded, setExcluded }: { overrides: Record<string, string>; setOverrides: (v: Record<string, string>) => void; excluded: string[]; setExcluded: (v: string[]) => void }) {
  const { t, locale } = useI18n();
  const { services } = useServices();
  // Keep services that are already excluded visible even when they have since been deactivated.
  const list = services.filter((s) => s.is_active || excluded.includes(s.id));
  return (
    <>
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
          {list.map((s) => (
            <Check key={s.id} label={`${s.code} · ${biName(s, locale)}${s.is_active ? '' : ` (${t('common.inactive')})`}`} checked={excluded.includes(s.id)} onChange={(v) => setExcluded(v ? [...excluded, s.id] : excluded.filter((x) => x !== s.id))} />
          ))}
        </div>
      </details>
    </>
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
        <SelectField label={t('insAdmin.kindLabel')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={PAYER_KINDS.map((k) => ({ value: k, label: t(`insAdmin.kind.${k}`) }))} />
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
          const typeOverrides = parseOverrides(overrides);
          if (!typeOverrides) return a.setError(t('insAdmin.percentRule'));
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
        <PlanRulesFields overrides={overrides} setOverrides={setOverrides} excluded={excluded} setExcluded={setExcluded} />
        <Check label={t('insAdmin.requiresApproval')} checked={f.requiresApproval} onChange={(v) => setF({ ...f, requiresApproval: v })} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy || !f.payerId}>
          {t('insAdmin.addPlan')}
        </Button>
      </form>
    </Section>
  );
}

interface UnverifiedCoverage {
  id: string;
  patient_id: string;
  mrn: string;
  patient_name_ar: string;
  patient_name_en: string | null;
  plan_name: string;
  payer_name_ar: string;
  payer_name_en: string | null;
  member_number: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
}

/** Insurance cover patients added in the portal: billing ignores it until staff check the card and approve it. */
function PendingVerification() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const q = useApi<UnverifiedCoverage[]>('/insurance/coverages/unverified');
  const [members, setMembers] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<UnverifiedCoverage | null>(null);
  const a = useAction();
  const approve = async (c: UnverifiedCoverage) => {
    const typed = (members[c.id] ?? c.member_number).trim();
    if (typed.length < 2 || typed.length > 60) return a.setError(t('insVerify.memberRule'));
    const r = await a.run(() => post(`/insurance/coverages/${c.id}/verify`, typed !== c.member_number ? { approve: true, memberNumber: typed } : { approve: true }));
    if (r) {
      toast(t('insVerify.approved'));
      q.reload();
    }
  };
  return (
    <div id="pending-verification" className="scroll-mt-4">
      <Section title={t('insVerify.title')} actions={q.data && q.data.length > 0 ? <Badge tone="warning">{q.data.length}</Badge> : undefined}>
        <p className="mb-3 text-sm text-muted">{t('insVerify.hint')}</p>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('patient.mrn')}</th>
                  <th>{t('insVerify.patient')}</th>
                  <th>{t('ins.payer')}</th>
                  <th>{t('ins.plan')}</th>
                  <th>{t('ins.member')}</th>
                  <th>{t('ins.validity')}</th>
                  <th>{t('insVerify.submitted')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/patients/${c.patient_id}`} className="underline">
                        <Bdi className="num">{c.mrn}</Bdi>
                      </Link>
                    </td>
                    <td>{biName({ name_ar: c.patient_name_ar, name_en: c.patient_name_en }, locale)}</td>
                    <td>{biName({ name_ar: c.payer_name_ar, name_en: c.payer_name_en }, locale)}</td>
                    <td>{c.plan_name}</td>
                    <td>
                      <Input
                        className="h-8 w-40"
                        value={members[c.id] ?? c.member_number}
                        onChange={(e) => setMembers({ ...members, [c.id]: e.target.value })}
                        aria-label={t('insVerify.memberFor', { mrn: c.mrn })}
                        maxLength={60}
                        dir="ltr"
                      />
                      {(members[c.id] ?? c.member_number).trim() !== c.member_number && <span className="mt-1 block text-xs text-muted">{t('insVerify.memberCorrected', { was: c.member_number })}</span>}
                    </td>
                    <td className="num text-xs">
                      {isoDate(c.valid_from)} → {c.valid_to ? isoDate(c.valid_to) : t('ins.openEnded')}
                    </td>
                    <td className="text-xs">
                      <DateText value={c.created_at} locale={locale} withTime />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" disabled={a.busy} onClick={() => void approve(c)}>
                          {t('common.approve')}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => setRejecting(c)}>
                          {t('common.reject')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <ConfirmDialog
        open={!!rejecting}
        title={t('insVerify.rejectTitle')}
        message={rejecting ? t('insVerify.rejectConfirm', { mrn: rejecting.mrn, member: rejecting.member_number }) : ''}
        confirmLabel={t('common.reject')}
        onClose={() => setRejecting(null)}
        onConfirm={async () => {
          if (!rejecting) return;
          await post(`/insurance/coverages/${rejecting.id}/verify`, { approve: false });
          toast(t('insVerify.rejected'));
          q.reload();
        }}
      />
    </div>
  );
}
