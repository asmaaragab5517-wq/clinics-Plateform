'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { DEFAULT_WORK_PATTERN, formatMoney } from '@hf/shared';
import { Alert, Badge, Bdi, Button, Money, PageHeader, Select, Table } from '@hf/ui';
import { Check, DataState, InlineError, ReasonDialog, Section, SelectField, TextField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { BalanceView, WorkPatternEditor } from '@/components/hr';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { ApiError, patch, post, put, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, egpInput, isoDate, num, parseEgp, todayCairo } from '@/lib/format';
import { IBAN_RE, cleanIban, daysCount, duration, fmtDay, fmtMonth, paidMinutes, patternDays, shiftText, type Allowance, type Balances, type ContractView, type HrStaffRow, type WorkPattern } from '@/lib/hr';

/** One person's employment contract, contract history and leave balance. */
export default function StaffContractPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const staff = useApi<HrStaffRow[]>('/hr/staff');
  const q = useApi<{ active: ContractView | null; history: ContractView[] }>(`/hr/staff/${userId}/contract`);
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endResult, setEndResult] = useState<EndResult | null>(null);
  const person = staff.data?.find((s) => s.id === userId);
  const name = person ? biName(person, locale) : '';
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={name || t('nav.hrStaff')}
        subtitle={person ? person.roles.map((r) => t(`role.${r}`)).join(t('common.listSep')) : undefined}
        actions={
          <Link href="/hr/staff" className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 hover:bg-bg">
            {t('common.back')}
          </Link>
        }
      />
      <DataState loading={q.loading} error={q.error} data={q.data}>
        {(d) => {
          const c = d.active;
          const payVisible = !!c && c.base_salary !== undefined;
          const canEdit = can('payroll:edit') && (!c || payVisible);
          return (
            <div className="grid gap-4 xl:grid-cols-3">
              <Section
                title={t('hr.contract.title')}
                className="xl:col-span-2"
                actions={
                  canEdit && (
                    <>
                      <Button size="sm" onClick={() => setEditing(true)}>
                        {c ? t('hr.contract.edit') : t('hr.contract.create')}
                      </Button>
                      {c && (
                        <Button size="sm" variant="danger" onClick={() => setEnding(true)}>
                          {t('hr.contract.end')}
                        </Button>
                      )}
                    </>
                  )
                }
              >
                {c ? <ContractDetails c={c} /> : <Alert tone="info">{t('hr.contract.noneHint')}</Alert>}
                {c && !payVisible && <p className="mt-3 text-xs text-muted">{t('hr.contract.payHidden')}</p>}
              </Section>
              <PersonBalance userId={userId} hasContract={!!c} />
              {d.history.length > 0 && (
                <Section title={t('hr.contract.history')} className="xl:col-span-3">
                  <Table>
                    <thead>
                      <tr>
                        <th>{t('hr.jobTitle')}</th>
                        <th>{t('hr.contract.type')}</th>
                        <th>{t('hr.contract.start')}</th>
                        <th>{t('hr.contract.endDate')}</th>
                        {d.history.some((h) => h.base_salary !== undefined) && <th>{t('hr.contract.salary')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {d.history.map((h) => (
                        <tr key={h.id}>
                          <td>{locale === 'en' ? h.job_title_en || h.job_title_ar : h.job_title_ar}</td>
                          <td className="text-xs">
                            {t(`hr.emp.${h.employment_type}`)} · {t(`hr.basis.${h.pay_basis}`)}
                          </td>
                          <td className="num">{fmtDay(h.start_date)}</td>
                          <td className="num">{fmtDay(h.end_date)}</td>
                          {h.base_salary !== undefined && (
                            <td>
                              <Money value={num(h.base_salary)} locale={locale} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Section>
              )}
              <ContractDialog
                open={editing}
                userId={userId}
                name={name}
                current={c}
                onClose={() => setEditing(false)}
                onSaved={() => {
                  toast(t('common.saved'));
                  q.reload();
                  staff.reload();
                }}
              />
              {c && <EndDialog open={ending} userId={userId} startDate={isoDate(c.start_date)} onClose={() => setEnding(false)} onDone={(r) => (toast(t('hr.contract.endedToast')), setEndResult(r), q.reload(), staff.reload())} />}
            </div>
          );
        }}
      </DataState>
      <Dialog open={!!endResult} onClose={() => setEndResult(null)} title={t('hr.contract.endedToast')}>
        {endResult && (
          <div className="flex flex-col gap-3">
            <Alert tone={endResult.leavePayout > 0 ? 'success' : 'info'}>{endResultText(t, locale, endResult)}</Alert>
            {endResult.unusedLeaveDays < 0 && <p className="text-sm text-warning">{t('hr.contract.endNegative')}</p>}
            <div className="flex justify-end">
              <Button onClick={() => setEndResult(null)}>{t('common.close')}</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** POST /hr/staff/:userId/contract/end: unused annual leave and what was added to the final month's payroll. */
interface EndResult {
  ok: boolean;
  unusedLeaveDays: number;
  /** Piastres; 0 when not paid (option unticked, nothing unused, or not a monthly salary). */
  leavePayout: number;
  payoutMonth: string;
}

function endResultText(t: ReturnType<typeof useI18n>['t'], locale: 'ar' | 'en', r: EndResult): string {
  const days = num(r.unusedLeaveDays);
  if (num(r.leavePayout) > 0) return t('hr.contract.endPaid', { days: daysCount(t, days), amount: formatMoney(num(r.leavePayout), locale), month: fmtMonth(r.payoutMonth) });
  if (days > 0) return t('hr.contract.endNotPaid', { days: daysCount(t, days) });
  return t('hr.contract.endNoLeave');
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ContractDetails({ c }: { c: ContractView }) {
  const { t, locale } = useI18n();
  const { me } = useSession();
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Row label={t('hr.jobTitle')}>{locale === 'en' ? c.job_title_en || c.job_title_ar : c.job_title_ar}</Row>
        <Row label={t('shell.clinic')}>{biName(me.clinics.find((x) => x.id === c.clinic_id), locale)}</Row>
        <Row label={t('common.status')}>
          <Badge tone={c.status === 'active' ? 'success' : 'neutral'}>{t(`hr.contract.${c.status}`)}</Badge>
        </Row>
        <Row label={t('hr.contract.type')}>{t(`hr.emp.${c.employment_type}`)}</Row>
        <Row label={t('hr.contract.payBasis')}>{t(`hr.basis.${c.pay_basis}`)}</Row>
        <Row label={t('hr.contract.start')}>
          <span className="num">{fmtDay(c.start_date)}</span>
        </Row>
        <Row label={t('hr.contract.endDate')}>
          <span className="num">{c.end_date ? fmtDay(c.end_date) : t('hr.contract.openEnded')}</span>
        </Row>
        <Row label={t('hr.workPattern')}>
          <span>
            {patternDays(t, c.work_pattern)} · {shiftText(t, c.work_pattern)}
          </span>
          <span className="block text-xs text-muted">{t('hr.pattern.paidDay', { d: duration(t, paidMinutes(c.work_pattern)) })}</span>
        </Row>
      </dl>
      {c.base_salary !== undefined && (
        <>
          <h3 className="font-display font-bold">{t('hr.contract.pay')}</h3>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Row label={c.pay_basis === 'hourly' ? t('hr.contract.hourlyRate') : t('hr.contract.salary')}>
              <Money value={num(c.base_salary)} locale={locale} />
            </Row>
            <Row label={t('hr.contract.insurableWage')}>{c.insurable_wage ? <Money value={num(c.insurable_wage)} locale={locale} /> : t('hr.contract.notInsured')}</Row>
            <Row label={t('hr.contract.siNumber')}>
              <Bdi className="num">{c.social_insurance_number || '—'}</Bdi>
            </Row>
            <Row label={t('hr.contract.bank')}>{c.bank_name || '—'}</Row>
            <Row label={t('hr.contract.iban')}>
              <Bdi className="num">{c.iban_last4 ? t('hr.contract.ibanMasked', { last4: c.iban_last4 }) : '—'}</Bdi>
            </Row>
            <Row label={t('hr.contract.dob')}>
              <span className="num">{c.date_of_birth ? fmtDay(c.date_of_birth) : '—'}</span>
            </Row>
          </dl>
          {(c.allowances ?? []).length > 0 && (
            <Table>
              <thead>
                <tr>
                  <th>{t('hr.allow.name')}</th>
                  <th>{t('hr.allow.amount')}</th>
                  <th>{t('hr.allow.taxable')}</th>
                </tr>
              </thead>
              <tbody>
                {(c.allowances ?? []).map((a) => (
                  <tr key={a.code}>
                    <td>{locale === 'en' ? a.nameEn || a.nameAr : a.nameAr}</td>
                    <td>
                      <Money value={num(a.amount)} locale={locale} />
                    </td>
                    <td>{a.taxable ? t('common.yes') : t('common.no')}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

interface AllowanceForm {
  code: string;
  nameAr: string;
  nameEn: string;
  amount: string;
  taxable: boolean;
}

interface ContractForm {
  clinicId: string;
  jobTitleAr: string;
  jobTitleEn: string;
  employmentType: string;
  payBasis: string;
  startDate: string;
  endDate: string;
  baseSalary: string;
  allowances: AllowanceForm[];
  insured: boolean;
  insurableWage: string;
  socialInsuranceNumber: string;
  bankName: string;
  iban: string;
  workPattern: WorkPattern;
  dateOfBirth: string;
}

function initialForm(c: ContractView | null, clinicId: string): ContractForm {
  return {
    clinicId: c?.clinic_id ?? clinicId,
    jobTitleAr: c?.job_title_ar ?? '',
    jobTitleEn: c?.job_title_en ?? '',
    employmentType: c?.employment_type ?? 'full_time',
    payBasis: c?.pay_basis ?? 'monthly',
    startDate: c ? isoDate(c.start_date) : todayCairo(),
    endDate: c?.end_date ? isoDate(c.end_date) : '',
    baseSalary: c ? egpInput(num(c.base_salary)) : '',
    allowances: (c?.allowances ?? []).map((a: Allowance) => ({ code: a.code, nameAr: a.nameAr, nameEn: a.nameEn ?? '', amount: egpInput(num(a.amount)), taxable: a.taxable !== false })),
    insured: c ? !!c.insurable_wage : true,
    insurableWage: c?.insurable_wage ? egpInput(num(c.insurable_wage)) : '',
    socialInsuranceNumber: c?.social_insurance_number ?? '',
    bankName: c?.bank_name ?? '',
    iban: '',
    workPattern: c?.work_pattern
      ? { days: [...c.work_pattern.days], start: c.work_pattern.start, end: c.work_pattern.end, ...(c.work_pattern.breakStart && c.work_pattern.breakEnd ? { breakStart: c.work_pattern.breakStart, breakEnd: c.work_pattern.breakEnd } : {}) }
      : { ...DEFAULT_WORK_PATTERN, days: [...DEFAULT_WORK_PATTERN.days] },
    dateOfBirth: c?.date_of_birth ? isoDate(c.date_of_birth) : '',
  };
}

/** Create or edit the active contract (PUT /hr/staff/:userId/contract, payroll:edit) with the full contract schema. */
function ContractDialog({ open, userId, name, current, onClose, onSaved }: { open: boolean; userId: string; name: string; current: ContractView | null; onClose: () => void; onSaved: () => void }) {
  const { t, locale, err } = useI18n();
  const { me, clinicId } = useSession();
  const [f, setF] = useState<ContractForm>(() => initialForm(current, clinicId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearIban, setClearIban] = useState(false);
  useEffect(() => {
    if (open) {
      setF(initialForm(current, clinicId));
      setErrors({});
      setError(null);
      setClearIban(false);
    }
  }, [open, current, clinicId]);
  const setA = (i: number, patchA: Partial<AllowanceForm>) => setF({ ...f, allowances: f.allowances.map((a, j) => (j === i ? { ...a, ...patchA } : a)) });

  function build(): Record<string, unknown> | null {
    const e: Record<string, string> = {};
    if (f.jobTitleAr.trim().length < 2) e.jobTitleAr = t('form.required');
    if (!f.clinicId) e.clinicId = t('form.required');
    const base = f.payBasis === 'commission_only' && !f.baseSalary.trim() ? 0 : parseEgp(f.baseSalary);
    if (base === null) e.baseSalary = t('form.invalidAmount');
    else if (f.payBasis !== 'commission_only' && base <= 0) e.baseSalary = t('err.base_salary_required');
    const allowances = f.allowances.map((a, i) => {
      const amount = parseEgp(a.amount);
      if (amount === null) e[`allow${i}`] = t('form.invalidAmount');
      if (!a.nameAr.trim()) e[`allow${i}`] = t('hr.allow.nameRequired');
      const code = (a.code.trim() || a.nameEn.trim() || `allowance_${i + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 30) || `allowance_${i + 1}`;
      return { code, nameAr: a.nameAr.trim(), nameEn: a.nameEn.trim(), amount: amount ?? 0, taxable: a.taxable };
    });
    if (new Set(allowances.map((a) => a.code)).size !== allowances.length) e.allowances = t('hr.allow.duplicateCode');
    const insurable = f.insured ? parseEgp(f.insurableWage) : null;
    if (f.insured && (insurable === null || insurable <= 0)) e.insurableWage = t('form.invalidAmount');
    const iban = cleanIban(f.iban);
    if (iban && !IBAN_RE.test(iban)) e.iban = t('hr.contract.ibanInvalid');
    if (!f.workPattern.days.length) e.workPattern = t('hr.pattern.noDays');
    if (f.workPattern.end <= f.workPattern.start) e.workPattern = t('hr.pattern.endBeforeStart');
    else if (f.workPattern.breakStart !== undefined || f.workPattern.breakEnd !== undefined) {
      const { breakStart: bs = '', breakEnd: be = '' } = f.workPattern;
      if (!bs || !be) e.workPattern = t('hr.pattern.breakBoth');
      else if (!(bs > f.workPattern.start && be > bs && be < f.workPattern.end)) e.workPattern = t('hr.pattern.breakInside');
    }
    if (f.endDate && f.endDate < f.startDate) e.endDate = t('err.end_before_start');
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      clinicId: f.clinicId,
      jobTitleAr: f.jobTitleAr.trim(),
      jobTitleEn: f.jobTitleEn.trim(),
      employmentType: f.employmentType,
      payBasis: f.payBasis,
      startDate: f.startDate,
      endDate: f.endDate || null,
      baseSalary: base ?? 0,
      allowances,
      insurableWage: insurable,
      socialInsuranceNumber: f.socialInsuranceNumber.trim() || null,
      bankName: f.bankName.trim() || null,
      // Omitted keeps the stored IBAN; null clears it.
      iban: iban ? iban : clearIban ? null : undefined,
      workPattern: {
        days: [...f.workPattern.days].sort(),
        start: f.workPattern.start,
        end: f.workPattern.end,
        ...(f.workPattern.breakStart && f.workPattern.breakEnd ? { breakStart: f.workPattern.breakStart, breakEnd: f.workPattern.breakEnd } : {}),
      },
      dateOfBirth: f.dateOfBirth || null,
    };
  }

  return (
    <Dialog open={open} onClose={onClose} title={current ? t('hr.contract.editTitle', { name }) : t('hr.contract.createTitle', { name })} wide>
      <form
        className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const body = build();
          if (!body) return setError(t('err.validation_failed'));
          setBusy(true);
          setError(null);
          try {
            await put(`/hr/staff/${userId}/contract`, body);
            onSaved();
            onClose();
          } catch (x) {
            setError(err(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField label={t('shell.clinic')} value={f.clinicId} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, clinicId: e.target.value })} options={me.clinics.map((c) => ({ value: c.id, label: biName(c, locale) }))} error={errors.clinicId} />
          <SelectField label={t('hr.contract.type')} value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value })} options={['full_time', 'part_time', 'contractor'].map((k) => ({ value: k, label: t(`hr.emp.${k}`) }))} />
          <TextField label={t('hr.contract.jobTitleAr')} value={f.jobTitleAr} onChange={(e) => setF({ ...f, jobTitleAr: e.target.value })} error={errors.jobTitleAr} dir="rtl" maxLength={120} />
          <TextField label={t('hr.contract.jobTitleEn')} value={f.jobTitleEn} onChange={(e) => setF({ ...f, jobTitleEn: e.target.value })} dir="ltr" maxLength={120} />
          <TextField label={t('hr.contract.start')} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          <TextField label={t('hr.contract.endDateOptional')} type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} error={errors.endDate} hint={t('hr.contract.endDateHint')} />
          <TextField label={t('hr.contract.dob')} type="date" value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} hint={t('hr.contract.dobHint')} />
        </div>
        <WorkPatternEditor value={f.workPattern} onChange={(p) => setF({ ...f, workPattern: p })} />
        <InlineError text={errors.workPattern ?? null} />

        <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('hr.contract.pay')}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField label={t('hr.contract.payBasis')} value={f.payBasis} onChange={(e) => setF({ ...f, payBasis: e.target.value })} options={['monthly', 'hourly', 'commission_only'].map((k) => ({ value: k, label: t(`hr.basis.${k}`) }))} />
            <TextField
              label={f.payBasis === 'hourly' ? t('hr.contract.hourlyRateEgp') : t('hr.contract.salaryEgp')}
              value={f.baseSalary}
              onChange={(e) => setF({ ...f, baseSalary: e.target.value })}
              inputMode="decimal"
              dir="ltr"
              error={errors.baseSalary}
              hint={f.payBasis === 'commission_only' ? t('hr.contract.commissionHint') : undefined}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('hr.allow.title')}</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setF({ ...f, allowances: [...f.allowances, { code: '', nameAr: '', nameEn: '', amount: '', taxable: true }] })} disabled={f.allowances.length >= 20}>
                {t('hr.allow.add')}
              </Button>
            </div>
            {f.allowances.length === 0 && <p className="text-xs text-muted">{t('hr.allow.none')}</p>}
            {f.allowances.map((a, i) => (
              <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-6">
                <div className="md:col-span-2">
                  <TextField label={t('hr.allow.nameAr')} value={a.nameAr} onChange={(e) => setA(i, { nameAr: e.target.value })} dir="rtl" />
                </div>
                <div className="md:col-span-2">
                  <TextField label={t('hr.allow.nameEn')} value={a.nameEn} onChange={(e) => setA(i, { nameEn: e.target.value })} dir="ltr" />
                </div>
                <TextField label={t('hr.allow.amountEgp')} value={a.amount} onChange={(e) => setA(i, { amount: e.target.value })} inputMode="decimal" dir="ltr" />
                <div className="flex flex-col gap-2 pb-1">
                  <Check label={t('hr.allow.taxable')} checked={a.taxable} onChange={(v) => setA(i, { taxable: v })} />
                  <Button type="button" size="sm" variant="ghost" onClick={() => setF({ ...f, allowances: f.allowances.filter((_, j) => j !== i) })}>
                    {t('common.remove')}
                  </Button>
                </div>
                <div className="col-span-2 md:col-span-6">
                  <InlineError text={errors[`allow${i}`] ?? null} />
                </div>
              </div>
            ))}
            <InlineError text={errors.allowances ?? null} />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('hr.contract.insuranceBank')}</legend>
          <Check label={t('hr.contract.insured')} checked={f.insured} onChange={(v) => setF({ ...f, insured: v })} hint={t('hr.contract.insuredHint')} />
          <div className="grid gap-3 md:grid-cols-2">
            {f.insured && <TextField label={t('hr.contract.insurableWageEgp')} value={f.insurableWage} onChange={(e) => setF({ ...f, insurableWage: e.target.value })} inputMode="decimal" dir="ltr" error={errors.insurableWage} />}
            <TextField label={t('hr.contract.siNumber')} value={f.socialInsuranceNumber} onChange={(e) => setF({ ...f, socialInsuranceNumber: e.target.value })} dir="ltr" maxLength={30} />
            <TextField label={t('hr.contract.bank')} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} maxLength={80} />
            <TextField
              label={t('hr.contract.iban')}
              value={f.iban}
              onChange={(e) => setF({ ...f, iban: e.target.value })}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder="EG000000000000000000000000000"
              error={errors.iban}
              hint={current?.iban_last4 ? t('hr.contract.ibanKeep', { last4: current.iban_last4 }) : t('hr.contract.ibanHint')}
            />
          </div>
          {current?.iban_last4 && !f.iban && <Check label={t('hr.contract.ibanClear')} checked={clearIban} onChange={setClearIban} />}
        </fieldset>

        <InlineError text={error} />
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EndDialog({ open, userId, startDate, onClose, onDone }: { open: boolean; userId: string; startDate: string; onClose: () => void; onDone: (r: EndResult) => void }) {
  const { t } = useI18n();
  const [endDate, setEndDate] = useState(todayCairo());
  const [payUnusedLeave, setPayUnusedLeave] = useState(true);
  return (
    <ReasonDialog
      open={open}
      title={t('hr.contract.endTitle')}
      confirmLabel={t('hr.contract.end')}
      onClose={onClose}
      onSubmit={async (reason) => {
        if (endDate < startDate) throw new ApiError(400, 'end_before_start');
        try {
          onDone(await post<EndResult>(`/hr/staff/${userId}/contract/end`, { endDate, reason, payUnusedLeave }));
        } catch (e) {
          // The final month's payroll is approved: the payout cannot be added there (nothing was changed).
          if (e instanceof ApiError && e.code === 'payroll_period_closed') throw new ApiError(e.status, 'leave_payout_period_closed', { month: fmtMonth(endDate.slice(0, 7)) });
          throw e;
        }
      }}
    >
      <TextField label={t('hr.contract.endDate')} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} hint={t('hr.contract.endHint')} />
      <Check label={t('hr.contract.payUnusedLeave')} checked={payUnusedLeave} onChange={setPayUnusedLeave} hint={t('hr.contract.payUnusedLeaveHint')} />
      <p className="text-xs text-muted">{t('hr.contract.endNegativeHint')}</p>
    </ReasonDialog>
  );
}

function PersonBalance({ userId, hasContract }: { userId: string; hasContract: boolean }) {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const thisYear = Number(todayCairo().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const q = useApi<Balances>(`/hr/balances${qs({ userId, year })}`);
  const [f, setF] = useState({ carried: '', adjusted: '', note: '' });
  const a = useAction();
  useEffect(() => {
    if (q.data) setF({ carried: String(num(q.data.annual.carried)), adjusted: String(num(q.data.annual.adjusted)), note: '' });
  }, [q.data]);
  return (
    <Section
      title={t('hr.balance.title')}
      actions={
        <Select className="!h-8 !w-24 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={t('hr.year')}>
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      }
    >
      <DataState loading={q.loading} error={q.error} data={q.data}>
        {(b) => (
          <div className="flex flex-col gap-4">
            {!hasContract && b.annual.balanceId === null ? <p className="text-sm text-muted">{t('hr.balance.noContract')}</p> : <BalanceView b={b} />}
            {can('hr:edit') && (hasContract || b.annual.balanceId) && (
              <form
                className="flex flex-col gap-3 border-t border-border pt-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (f.note.trim().length < 3) return a.setError(t('form.reasonMin', { n: 3 }));
                  const carried = Number(f.carried);
                  const adjusted = Number(f.adjusted);
                  if (!Number.isFinite(carried) || carried < 0 || carried > 90 || !Number.isFinite(adjusted) || adjusted < -90 || adjusted > 90) return a.setError(t('hr.balance.range'));
                  const r = await a.run(() => patch('/hr/balances', { userId, year, carried, adjusted, note: f.note.trim() }));
                  if (r) {
                    toast(t('common.saved'));
                    q.reload();
                  }
                }}
              >
                <p className="text-sm font-medium">{t('hr.balance.adjustTitle')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <TextField label={t('hr.balance.carried')} type="number" min={0} max={90} step={0.5} value={f.carried} onChange={(e) => setF({ ...f, carried: e.target.value })} />
                  <TextField label={t('hr.balance.adjusted')} type="number" min={-90} max={90} step={0.5} value={f.adjusted} onChange={(e) => setF({ ...f, adjusted: e.target.value })} />
                </div>
                <TextField label={t('hr.balance.note')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required minLength={3} maxLength={300} />
                {a.error && <Alert tone="danger">{a.error}</Alert>}
                <Button type="submit" size="sm" disabled={a.busy}>
                  {t('common.save')}
                </Button>
              </form>
            )}
          </div>
        )}
      </DataState>
    </Section>
  );
}
