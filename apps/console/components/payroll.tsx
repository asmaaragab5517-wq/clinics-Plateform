'use client';

import { useState } from 'react';
import { ADJUSTMENT_KINDS } from '@hf/shared/hr';
import { Alert, Bdi, Button, Money, Table } from '@hf/ui';
import { Check, ConfirmDialog, DataState, Section, SelectField, TextField, useAction } from './common';
import { useI18n } from './i18n';
import { useSession } from './session';
import { useToast } from './toast';
import { del, post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, num, parseEgp } from '@/lib/format';
import { fmtMonth, lineQuantity, type PayrollPerson, type PayslipLine } from '@/lib/hr';

export interface RunTotals {
  net: number;
  gross: number;
  people: number;
  incomeTax: number;
  deductions: number;
  martyrsFund: number;
  employerCost: number;
  employeeInsurance: number;
  employerInsurance: number;
}

export interface PayrollRun {
  id: string;
  period: string;
  month: string;
  status: 'draft' | 'approved' | 'paid' | 'cancelled';
  totals: RunTotals | null;
  warnings: string[] | null;
  created_by: string | null;
  calculated_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by_name_ar?: string | null;
  created_by_name_en?: string | null;
  approved_by_name_ar?: string | null;
  approved_by_name_en?: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface Payslip {
  id: string;
  user_id: string;
  clinic_id: string;
  gross: number;
  deductions: number;
  net: number;
  employer_cost: number;
  lines: PayslipLine[];
  inputs: Record<string, number>;
  warnings: string[];
  name_ar: string;
  name_en: string;
  job_title_ar: string;
  job_title_en: string;
  pay_basis: string;
}

/** Not taxable by default on the API side; the form mirrors that. */
const NON_TAXABLE = new Set(['reimbursement', 'advance', 'advance_repayment']);
/** Kinds that add to pay (the rest reduce it). */
const EARNING_KINDS = new Set(['bonus', 'allowance', 'overtime', 'reimbursement', 'advance', 'leave_encashment']);

interface Adjustment {
  id: string;
  user_id: string;
  kind: string;
  amount: number;
  taxable: boolean;
  note: string | null;
  name_ar: string;
  name_en: string;
  created_at: string;
}

/**
 * One-off pay items for a month (bonus, deduction, advance …). Amounts are typed in EGP and sent in piastres; the
 * API refuses changes once that month's run is approved (payroll_period_closed).
 */
export function Adjustments({ month, closed, onChanged }: { month: string; closed?: boolean; onChanged?: () => void }) {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<Adjustment[]>(`/payroll/adjustments${qs({ month })}`);
  // Contract holders from payroll itself, so preparing payroll does not need HR access.
  const peopleQ = useApi<PayrollPerson[]>(can('payroll:edit') ? '/payroll/people' : null);
  const [f, setF] = useState({ userId: '', kind: 'bonus', amount: '', taxable: true, note: '' });
  const [removing, setRemoving] = useState<Adjustment | null>(null);
  const a = useAction();
  const edit = can('payroll:edit') && !closed;
  const people = [...(peopleQ.data ?? [])].sort((x, y) => (x.status === y.status ? biName(x, locale).localeCompare(biName(y, locale), locale) : x.status === 'active' ? -1 : 1));
  const personLabel = (p: PayrollPerson) => {
    const job = locale === 'en' ? p.job_title_en || p.job_title_ar : p.job_title_ar;
    return [biName(p, locale), job, p.status === 'ended' ? t('pay.adj.contractEnded') : null].filter(Boolean).join(' · ');
  };
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('pay.adj.title', { month: fmtMonth(month) })} className={edit ? 'xl:col-span-2' : 'xl:col-span-3'}>
        {closed && <Alert tone="info">{t('pay.adj.closed')}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('hr.person')}</th>
                  <th>{t('pay.adj.kind')}</th>
                  <th>{t('pay.adj.amount')}</th>
                  <th>{t('hr.allow.taxable')}</th>
                  <th>{t('pay.adj.note')}</th>
                  {edit && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Bdi>{biName(r, locale)}</Bdi>
                    </td>
                    <td>{t(`pay.adjKind.${r.kind}`)}</td>
                    <td className={EARNING_KINDS.has(r.kind) ? 'whitespace-nowrap' : 'whitespace-nowrap text-danger'}>
                      <Money value={EARNING_KINDS.has(r.kind) ? num(r.amount) : -num(r.amount)} locale={locale} />
                    </td>
                    <td>{r.taxable ? t('common.yes') : t('common.no')}</td>
                    <td className="text-xs">{r.kind === 'leave_encashment' ? lineQuantity(t, { basis: r.note ?? undefined }).text ?? r.note : r.note}</td>
                    {edit && (
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>
                          {t('common.delete')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      {edit && (
        <Section title={t('pay.adj.add')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const amount = parseEgp(f.amount);
              if (amount === null || amount <= 0) return a.setError(t('form.invalidAmount'));
              if (f.note.trim().length < 2) return a.setError(t('pay.adj.noteRequired'));
              const r = await a.run(() => post('/payroll/adjustments', { userId: f.userId, month, kind: f.kind, amount, taxable: f.taxable, note: f.note.trim() }));
              if (r) {
                toast(t('pay.adj.added'));
                setF({ ...f, amount: '', note: '' });
                q.reload();
                onChanged?.();
              }
            }}
          >
            <SelectField label={t('hr.person')} value={f.userId} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, userId: e.target.value })} options={people.map((p) => ({ value: p.id, label: personLabel(p) }))} required error={peopleQ.error ? t('pay.adj.peopleError') : undefined} />
            <SelectField label={t('pay.adj.kind')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, taxable: !NON_TAXABLE.has(e.target.value) })} options={ADJUSTMENT_KINDS.map((k) => ({ value: k, label: t(`pay.adjKind.${k}`) }))} />
            <p className="text-xs text-muted">{t(`pay.adjHint.${f.kind}`)}</p>
            <TextField label={t('pay.adj.amountEgp')} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" dir="ltr" required />
            <Check label={t('pay.adj.taxable')} checked={f.taxable} onChange={(v) => setF({ ...f, taxable: v })} hint={t('pay.adj.taxableHint')} />
            <TextField label={t('pay.adj.note')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required minLength={2} maxLength={300} />
            <p className="text-xs text-muted">{t('pay.adj.recalcHint')}</p>
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy || !f.userId}>
              {t('common.add')}
            </Button>
          </form>
        </Section>
      )}
      <ConfirmDialog
        open={!!removing}
        title={t('pay.adj.delete')}
        message={removing ? t('pay.adj.deleteConfirm', { kind: t(`pay.adjKind.${removing.kind}`), name: biName(removing, locale) }) : ''}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await del(`/payroll/adjustments/${removing.id}`);
          toast(t('pay.adj.deleted'));
          q.reload();
          onChanged?.();
        }}
      />
    </div>
  );
}

/** Name of the person who prepared or approved a run (null when unknown). */
export function runPerson(r: PayrollRun, who: 'created_by' | 'approved_by', locale: 'ar' | 'en'): string | null {
  const ar = r[`${who}_name_ar`];
  const en = r[`${who}_name_en`];
  return (locale === 'en' ? en || ar : ar || en) || null;
}
