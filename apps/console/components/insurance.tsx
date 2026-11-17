'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Bdi, Button, Table } from '@hf/ui';
import { patch, post } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, isoDate, todayCairo } from '@/lib/format';
import { DataState, Section, SelectField, TextField, useAction } from './common';
import { useI18n } from './i18n';
import { useSession } from './session';
import { useToast } from './toast';

/** Insurance / TPA (FR-BIL-11): shared types and the patient coverage panel. */

export interface PayerPlan {
  id: string;
  payer_id: string;
  name: string;
  coverage_percent: number | string;
  copay_fixed: number;
  type_overrides: Record<string, number>;
  excluded_service_ids: string[];
  requires_approval: boolean;
  annual_limit: number | null;
  is_active: boolean;
}

export interface Payer {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  kind: 'insurer' | 'tpa' | 'corporate';
  contact: Record<string, string>;
  is_active: boolean;
  plans: PayerPlan[];
}

export interface Coverage {
  id: string;
  patient_id: string;
  plan_id: string;
  member_number: string;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  plan_name: string;
  coverage_percent: number | string;
  copay_fixed: number;
  requires_approval: boolean;
  payer_name_ar: string;
  payer_name_en: string;
  /** Who added it: staff, or the patient in the portal (needs verification before billing uses it). */
  source?: 'staff' | 'patient';
  verified_at?: string | null;
}

/** Billing ignores cover that staff have not verified yet. */
export function coverageVerified(c: Coverage): boolean {
  return c.verified_at !== null;
}

export function coverageValidOn(c: Coverage, date = todayCairo()): boolean {
  return c.is_active && coverageVerified(c) && isoDate(c.valid_from) <= date && (!c.valid_to || isoDate(c.valid_to) >= date);
}

export function coverageLabel(c: Coverage, locale: 'ar' | 'en'): string {
  return `${biName({ name_ar: c.payer_name_ar, name_en: c.payer_name_en }, locale)} · ${c.plan_name} · ${Number(c.coverage_percent)}%`;
}

export function PatientCoverages({ patientId }: { patientId: string }) {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<Coverage[]>(`/insurance/patients/${patientId}/coverages`);
  const payers = useApi<Payer[]>(can('patient:edit') && can('bill:view') ? '/insurance/payers' : null);
  const [f, setF] = useState({ payerId: '', planId: '', memberNumber: '', validFrom: todayCairo(), validTo: '' });
  const a = useAction();
  const plans = payers.data?.find((p) => p.id === f.payerId)?.plans.filter((p) => p.is_active) ?? [];
  const today = todayCairo();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title={t('ins.coverages')} className="lg:col-span-2">
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('ins.payer')}</th>
                  <th>{t('ins.plan')}</th>
                  <th>{t('ins.member')}</th>
                  <th>{t('ins.validity')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>{biName({ name_ar: c.payer_name_ar, name_en: c.payer_name_en }, locale)}</td>
                    <td>
                      {c.plan_name} <span className="num text-xs text-muted">{`${Number(c.coverage_percent)}%`}</span>
                      {c.requires_approval && <Badge tone="warning" className="ms-1">{t('ins.needsApproval')}</Badge>}
                    </td>
                    <td>
                      <Bdi className="num">{c.member_number}</Bdi>
                    </td>
                    <td className="num text-xs">
                      {isoDate(c.valid_from)} → {c.valid_to ? isoDate(c.valid_to) : t('ins.openEnded')}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        {!coverageVerified(c) && c.is_active ? (
                          <Badge tone="warning">{t('insVerify.awaiting')}</Badge>
                        ) : coverageValidOn(c, today) ? (
                          <Badge tone="success">{t('common.active')}</Badge>
                        ) : (
                          <Badge>{c.is_active ? t('ins.outOfPeriod') : t('common.inactive')}</Badge>
                        )}
                        {c.source === 'patient' && <span className="text-xs text-muted">{t('insVerify.fromPortal')}</span>}
                      </div>
                    </td>
                    <td>
                      {can('patient:edit') && c.is_active && !coverageVerified(c) && (
                        <Link href="/finance/insurance#pending-verification" className="me-2 text-xs underline">
                          {t('insVerify.verifyLink')}
                        </Link>
                      )}
                      {can('patient:edit') && c.is_active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={a.busy}
                          onClick={async () => {
                            const r = await a.run(() => patch(`/insurance/coverages/${c.id}`, { isActive: false }));
                            if (r) {
                              toast(t('ins.deactivated'));
                              q.reload();
                            }
                          }}
                        >
                          {t('ins.deactivate')}
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
      {can('patient:edit') && (
        <Section title={t('ins.addCoverage')}>
          {payers.data?.length === 0 ? (
            <p className="text-sm text-muted">{t('ins.noPayers')}</p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await a.run(() => post(`/insurance/patients/${patientId}/coverages`, { planId: f.planId, memberNumber: f.memberNumber.trim(), validFrom: f.validFrom, validTo: f.validTo || undefined }));
                if (r) {
                  toast(t('common.saved'));
                  setF({ payerId: '', planId: '', memberNumber: '', validFrom: todayCairo(), validTo: '' });
                  q.reload();
                }
              }}
            >
              <SelectField label={t('ins.payer')} value={f.payerId} required placeholder={t('form.choose')} onChange={(e) => setF({ ...f, payerId: e.target.value, planId: '' })} options={(payers.data ?? []).filter((p) => p.is_active).map((p) => ({ value: p.id, label: biName(p, locale) }))} />
              <SelectField label={t('ins.plan')} value={f.planId} required disabled={!f.payerId} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, planId: e.target.value })} options={plans.map((p) => ({ value: p.id, label: `${p.name} · ${Number(p.coverage_percent)}%` }))} />
              <TextField label={t('ins.member')} value={f.memberNumber} onChange={(e) => setF({ ...f, memberNumber: e.target.value })} required minLength={2} maxLength={60} dir="ltr" />
              <div className="grid grid-cols-2 gap-2">
                <TextField label={t('ins.validFrom')} type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} required />
                <TextField label={t('ins.validTo')} type="date" value={f.validTo} min={f.validFrom} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
              </div>
              <Button type="submit" disabled={a.busy || !f.planId}>
                {t('ins.addCoverage')}
              </Button>
            </form>
          )}
        </Section>
      )}
    </div>
  );
}
