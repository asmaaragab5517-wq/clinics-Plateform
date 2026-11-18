'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Bdi, Button, PageHeader, Select, Table, Tabs } from '@hf/ui';
import { Check, ConfirmDialog, DataState, InlineError, Section, TextAreaField, TextField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { del, patch, post, put, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, egpInput, num, parseEgp, todayCairo } from '@/lib/format';
import { fmtDay, fromPercent, toPercent, normaliseNetwork, type AttendanceRules, type HrSettings, type LeaveType } from '@/lib/hr';
import type { Clinic } from '@/lib/types';

type Tab = 'rules' | 'location' | 'holidays' | 'leave';

/** Attendance and payroll rules, public holidays and leave types (read with hr:view, save with settings:edit / hr:edit). */
export default function HrSettingsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('rules');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.hrSettings')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'rules', label: t('hr.set.rulesTab') },
          { value: 'location', label: t('hr.loc.tab') },
          { value: 'holidays', label: t('hr.set.holidaysTab') },
          { value: 'leave', label: t('hr.set.leaveTab') },
        ]}
      />
      {tab === 'rules' && <Rules />}
      {tab === 'location' && <ClockLocation />}
      {tab === 'holidays' && <Holidays />}
      {tab === 'leave' && <LeaveTypes />}
    </div>
  );
}

interface RulesForm {
  graceMinutes: string;
  permissionsPerMonth: string;
  permissionMinutesPerMonth: string;
  deductLateness: boolean;
  overtimeMultiplier: string;
  restDayMultiplier: string;
  nightOvertimeMultiplier: string;
  nightStart: string;
  nightEnd: string;
  daysPerMonth: string;
  siYear: string;
  siEmployee: string;
  siEmployer: string;
  siMin: string;
  siMax: string;
  exemption: string;
  brackets: { upTo: string; rate: string }[];
  martyrs: string;
}

function toForm(s: HrSettings): RulesForm {
  return {
    graceMinutes: String(s.graceMinutes),
    permissionsPerMonth: String(s.permissionsPerMonth),
    permissionMinutesPerMonth: String(s.permissionMinutesPerMonth),
    deductLateness: s.deductLateness,
    overtimeMultiplier: String(s.overtimeMultiplier),
    restDayMultiplier: String(s.restDayMultiplier),
    nightOvertimeMultiplier: String(s.nightOvertimeMultiplier),
    nightStart: s.nightStart,
    nightEnd: s.nightEnd,
    daysPerMonth: String(s.daysPerMonth),
    siYear: String(s.socialInsurance.year),
    siEmployee: String(toPercent(s.socialInsurance.employeeRate)),
    siEmployer: String(toPercent(s.socialInsurance.employerRate)),
    siMin: egpInput(s.socialInsurance.minWage),
    siMax: egpInput(s.socialInsurance.maxWage),
    exemption: egpInput(s.incomeTax.personalExemption),
    brackets: s.incomeTax.brackets.map((b) => ({ upTo: b.upTo === null ? '' : egpInput(b.upTo), rate: String(toPercent(b.rate)) })),
    martyrs: String(toPercent(s.martyrsFundRate)),
  };
}

function Rules() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<HrSettings>('/hr/settings');
  const [f, setF] = useState<RulesForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const a = useAction();
  const [resetting, setResetting] = useState(false);
  const ro = !can('settings:edit');
  useEffect(() => {
    if (q.data) setF(toForm(q.data));
  }, [q.data]);
  const thisYear = Number(todayCairo().slice(0, 4));

  function build(x: RulesForm): HrSettings | null {
    const e: Record<string, string> = {};
    const int = (k: keyof RulesForm, v: string, min: number, max: number) => {
      const n = Number(v);
      if (!/^-?\d+$/.test(v.trim()) || n < min || n > max) e[k] = t('hr.set.range', { min, max });
      return n;
    };
    const dec = (k: string, v: string, min: number, max: number) => {
      const n = Number(v);
      if (!v.trim() || !Number.isFinite(n) || n < min || n > max) e[k] = t('hr.set.range', { min, max });
      return n;
    };
    const hhmm = (k: string, v: string) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) e[k] = t('hr.set.timeInvalid');
      return v;
    };
    const money = (k: string, v: string) => {
      const p = parseEgp(v);
      if (p === null) e[k] = t('form.invalidAmount');
      return p ?? 0;
    };
    const out: HrSettings = {
      graceMinutes: int('graceMinutes', x.graceMinutes, 0, 120),
      permissionsPerMonth: int('permissionsPerMonth', x.permissionsPerMonth, 0, 31),
      permissionMinutesPerMonth: int('permissionMinutesPerMonth', x.permissionMinutesPerMonth, 0, 6000),
      deductLateness: x.deductLateness,
      overtimeMultiplier: dec('overtimeMultiplier', x.overtimeMultiplier, 1, 5),
      restDayMultiplier: dec('restDayMultiplier', x.restDayMultiplier, 1, 5),
      nightOvertimeMultiplier: dec('nightOvertimeMultiplier', x.nightOvertimeMultiplier, 1, 5),
      nightStart: hhmm('nightStart', x.nightStart),
      nightEnd: hhmm('nightEnd', x.nightEnd),
      daysPerMonth: int('daysPerMonth', x.daysPerMonth, 20, 31),
      socialInsurance: {
        year: int('siYear', x.siYear, 2020, 2100),
        employeeRate: fromPercent(dec('siEmployee', x.siEmployee, 0, 100)),
        employerRate: fromPercent(dec('siEmployer', x.siEmployer, 0, 100)),
        minWage: money('siMin', x.siMin),
        maxWage: money('siMax', x.siMax),
      },
      incomeTax: {
        personalExemption: money('exemption', x.exemption),
        brackets: x.brackets.map((b, i) => ({ upTo: i === x.brackets.length - 1 ? null : money(`bracket${i}`, b.upTo), rate: fromPercent(dec(`bracketRate${i}`, b.rate, 0, 100)) })),
      },
      martyrsFundRate: fromPercent(dec('martyrs', x.martyrs, 0, 1)),
    };
    if (out.socialInsurance.maxWage < out.socialInsurance.minWage) e.siMax = t('hr.set.maxBelowMin');
    const ups = out.incomeTax.brackets.slice(0, -1).map((b) => b.upTo ?? 0);
    if (ups.some((u, i) => u <= 0 || (i > 0 && u <= (ups[i - 1] ?? 0)))) e.brackets = t('hr.set.bracketsAscending');
    setErrors(e);
    return Object.keys(e).length ? null : out;
  }

  return (
    <DataState loading={q.loading} error={q.error} data={f ?? undefined}>
      {(x) => {
        const set = (p: Partial<RulesForm>) => setF({ ...x, ...p });
        const outdated = Number(x.siYear) < thisYear;
        return (
          <>
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                const body = build(x);
                if (!body) return a.setError(t('err.validation_failed'));
                const r = await a.run(() => patch<HrSettings>('/hr/settings', body));
                if (r) {
                  toast(t('common.saved'));
                  q.setData(r);
                }
              }}
            >
              <Alert tone="warning">{t('hr.set.legalNote')}</Alert>
              {ro && <Alert tone="info">{t('hr.set.readOnly')}</Alert>}
              <fieldset disabled={ro} className="grid gap-4 xl:grid-cols-2">
                <Section title={t('hr.set.attendance')}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <TextField label={t('hr.set.grace')} type="number" min={0} max={120} value={x.graceMinutes} onChange={(e) => set({ graceMinutes: e.target.value })} error={errors.graceMinutes} hint={t('hr.set.graceHint')} />
                    <TextField label={t('hr.set.daysPerMonth')} type="number" min={20} max={31} value={x.daysPerMonth} onChange={(e) => set({ daysPerMonth: e.target.value })} error={errors.daysPerMonth} hint={t('hr.set.daysPerMonthHint')} />
                    <TextField label={t('hr.set.permsPerMonth')} type="number" min={0} max={31} value={x.permissionsPerMonth} onChange={(e) => set({ permissionsPerMonth: e.target.value })} error={errors.permissionsPerMonth} />
                    <TextField label={t('hr.set.permMinutes')} type="number" min={0} max={6000} value={x.permissionMinutesPerMonth} onChange={(e) => set({ permissionMinutesPerMonth: e.target.value })} error={errors.permissionMinutesPerMonth} />
                    <div className="md:col-span-2">
                      <Check label={t('hr.set.deductLateness')} checked={x.deductLateness} onChange={(v) => set({ deductLateness: v })} hint={t('hr.set.deductLatenessHint')} disabled={ro} />
                    </div>
                    <TextField label={t('hr.set.otMultiplier')} type="number" step={0.05} min={1} max={5} value={x.overtimeMultiplier} onChange={(e) => set({ overtimeMultiplier: e.target.value })} error={errors.overtimeMultiplier} dir="ltr" />
                    <TextField label={t('hr.set.restMultiplier')} type="number" step={0.05} min={1} max={5} value={x.restDayMultiplier} onChange={(e) => set({ restDayMultiplier: e.target.value })} error={errors.restDayMultiplier} dir="ltr" />
                    <div className="md:col-span-2">
                      <p className="text-sm font-medium">{t('hr.set.night')}</p>
                      <p className="text-xs text-muted">{t('hr.set.nightHint')}</p>
                    </div>
                    <TextField label={t('hr.set.nightMultiplier')} type="number" step={0.05} min={1} max={5} value={x.nightOvertimeMultiplier} onChange={(e) => set({ nightOvertimeMultiplier: e.target.value })} error={errors.nightOvertimeMultiplier} dir="ltr" />
                    <div />
                    <TextField label={t('hr.set.nightStart')} type="time" value={x.nightStart} onChange={(e) => set({ nightStart: e.target.value })} error={errors.nightStart} />
                    <TextField label={t('hr.set.nightEnd')} type="time" value={x.nightEnd} onChange={(e) => set({ nightEnd: e.target.value })} error={errors.nightEnd} hint={t('hr.set.nightEndHint')} />
                  </div>
                </Section>
                <Section title={t('hr.set.si')}>
                  {outdated && <Alert tone="warning">{t('hr.set.siOutdated', { year: x.siYear, now: thisYear })}</Alert>}
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <TextField label={t('hr.set.siYear')} type="number" min={2020} max={2100} value={x.siYear} onChange={(e) => set({ siYear: e.target.value })} error={errors.siYear} hint={t('hr.set.siYearHint')} />
                    <div />
                    <TextField label={t('hr.set.siEmployee')} type="number" step={0.01} value={x.siEmployee} onChange={(e) => set({ siEmployee: e.target.value })} error={errors.siEmployee} dir="ltr" />
                    <TextField label={t('hr.set.siEmployer')} type="number" step={0.01} value={x.siEmployer} onChange={(e) => set({ siEmployer: e.target.value })} error={errors.siEmployer} dir="ltr" />
                    <TextField label={t('hr.set.siMin')} value={x.siMin} onChange={(e) => set({ siMin: e.target.value })} error={errors.siMin} inputMode="decimal" dir="ltr" />
                    <TextField label={t('hr.set.siMax')} value={x.siMax} onChange={(e) => set({ siMax: e.target.value })} error={errors.siMax} inputMode="decimal" dir="ltr" />
                  </div>
                </Section>
                <Section title={t('hr.set.tax')} className="xl:col-span-2">
                  <div className="grid gap-3 md:grid-cols-3">
                    <TextField label={t('hr.set.exemption')} value={x.exemption} onChange={(e) => set({ exemption: e.target.value })} error={errors.exemption} inputMode="decimal" dir="ltr" hint={t('hr.set.exemptionHint')} />
                    <TextField label={t('hr.set.martyrs')} type="number" step={0.01} min={0} max={1} value={x.martyrs} onChange={(e) => set({ martyrs: e.target.value })} error={errors.martyrs} dir="ltr" hint={t('hr.set.martyrsHint')} />
                  </div>
                  <p className="mt-3 text-sm font-medium">{t('hr.set.brackets')}</p>
                  <p className="text-xs text-muted">{t('hr.set.bracketsHint')}</p>
                  <div className="mt-2 flex flex-col gap-2">
                    {x.brackets.map((b, i) => {
                      const last = i === x.brackets.length - 1;
                      const from = i === 0 ? '0.00' : x.brackets[i - 1]?.upTo ?? '';
                      return (
                        <div key={i} className="grid grid-cols-2 items-end gap-2 md:grid-cols-4">
                          <p className="pb-2 text-sm text-muted">{t('hr.set.bracketFrom', { from })}</p>
                          {last ? (
                            <p className="pb-2 text-sm">{t('hr.set.bracketAbove')}</p>
                          ) : (
                            <TextField label={t('hr.set.bracketUpTo')} value={b.upTo} onChange={(e) => set({ brackets: x.brackets.map((y, j) => (j === i ? { ...y, upTo: e.target.value } : y)) })} error={errors[`bracket${i}`]} inputMode="decimal" dir="ltr" />
                          )}
                          <TextField label={t('hr.set.bracketRate')} type="number" step={0.5} min={0} max={100} value={b.rate} onChange={(e) => set({ brackets: x.brackets.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)) })} error={errors[`bracketRate${i}`]} dir="ltr" />
                          {!ro && x.brackets.length > 1 && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => set({ brackets: x.brackets.filter((_, j) => j !== i) })}>
                              {t('common.remove')}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    <InlineError text={errors.brackets ?? null} />
                    {!ro && (
                      <div>
                        <Button type="button" size="sm" variant="secondary" onClick={() => set({ brackets: [...x.brackets.slice(0, -1), { upTo: '', rate: '' }, ...x.brackets.slice(-1)] })}>
                          {t('hr.set.addBracket')}
                        </Button>
                      </div>
                    )}
                  </div>
                </Section>
              </fieldset>
              {a.error && <Alert tone="danger">{a.error}</Alert>}
              {!ro && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <Button type="button" variant="ghost" onClick={() => setResetting(true)} disabled={a.busy}>
                      {t('hr.set.reset')}
                    </Button>
                    <p className="max-w-md text-xs text-muted">{t('hr.set.storedHint')}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => q.data && setF(toForm(q.data))}>
                      {t('hr.set.revert')}
                    </Button>
                    <Button type="submit" disabled={a.busy}>
                      {t('common.save')}
                    </Button>
                  </div>
                </div>
              )}
            </form>
            <ConfirmDialog
              open={resetting}
              title={t('hr.set.resetTitle')}
              message={t('hr.set.resetConfirm')}
              confirmLabel={t('hr.set.reset')}
              onClose={() => setResetting(false)}
              onConfirm={async () => {
                const r = await del<HrSettings>('/hr/settings');
                q.setData(r);
                setErrors({});
                a.setError(null);
                toast(t('hr.set.resetDone'));
              }}
            />
          </>
        );
      }}
    </DataState>
  );
}

interface Holiday {
  id: string;
  holiday_date: string;
  name_ar: string;
  name_en: string;
}

function Holidays() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const thisYear = Number(todayCairo().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const q = useApi<Holiday[]>(`/hr/holidays${qs({ year })}`);
  const [f, setF] = useState({ date: '', nameAr: '', nameEn: '' });
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const a = useAction();
  const edit = can('hr:edit');
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section
        title={t('hr.set.holidays', { year })}
        className="xl:col-span-2"
        actions={
          <Select className="!h-8 !w-24 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={t('hr.year')}>
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        }
      >
        <p className="mb-2 text-xs text-muted">{t('hr.set.holidaysHint')}</p>
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('hr.set.holidayName')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id}>
                    <td className="num">{fmtDay(h.holiday_date)}</td>
                    <td>
                      <Bdi>{locale === 'en' ? h.name_en || h.name_ar : h.name_ar}</Bdi>
                    </td>
                    <td>
                      {edit && (
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(h)}>
                          {t('common.delete')}
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
      {edit && (
        <Section title={t('hr.set.addHoliday')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (f.nameAr.trim().length < 2) return a.setError(t('form.required'));
              const r = await a.run(() => post('/hr/holidays', { date: f.date, nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() }));
              if (r) {
                toast(t('common.saved'));
                setF({ date: '', nameAr: '', nameEn: '' });
                if (f.date.slice(0, 4) !== String(year)) setYear(Number(f.date.slice(0, 4)));
                else q.reload();
              }
            }}
          >
            <TextField label={t('common.date')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
            <TextField label={t('hr.set.nameAr')} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} dir="rtl" required minLength={2} />
            <TextField label={t('hr.set.nameEn')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" />
            <p className="text-xs text-muted">{t('hr.set.holidaySameDay')}</p>
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy || !f.date}>
              {t('common.add')}
            </Button>
          </form>
        </Section>
      )}
      <ConfirmDialog
        open={!!removing}
        title={t('hr.set.deleteHoliday')}
        message={removing ? t('hr.set.deleteHolidayConfirm', { d: fmtDay(removing.holiday_date), name: locale === 'en' ? removing.name_en || removing.name_ar : removing.name_ar }) : ''}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await del(`/hr/holidays/${removing.id}`);
          toast(t('hr.set.holidayDeleted'));
          q.reload();
        }}
      />
    </div>
  );
}

function LeaveTypes() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const q = useApi<LeaveType[]>('/hr/leave-types');
  const [editing, setEditing] = useState<LeaveType | null>(null);
  return (
    <Section title={t('hr.set.leaveTypes')}>
      <p className="mb-2 text-xs text-muted">{t('hr.set.leaveTypesHint')}</p>
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('hr.leaveType')}</th>
                <th>{t('hr.set.paid')}</th>
                <th>{t('hr.set.pool')}</th>
                <th>{t('hr.set.quota')}</th>
                <th>{t('hr.set.maxConsecutive')}</th>
                <th>{t('common.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {locale === 'en' ? r.name_en || r.name_ar : r.name_ar}
                    <span className="block text-xs text-muted">
                      <bdi>{r.code}</bdi>
                    </span>
                  </td>
                  <td>{r.paid ? t('common.yes') : t('common.no')}</td>
                  <td>{r.uses_annual_balance ? t('common.yes') : t('common.no')}</td>
                  <td className="num">{r.annual_quota === null ? '—' : num(r.annual_quota)}</td>
                  <td className="num">{r.max_consecutive_days === null ? '—' : num(r.max_consecutive_days)}</td>
                  <td>
                    <Badge tone={r.is_active ? 'success' : 'neutral'}>{t(r.is_active ? 'common.active' : 'common.inactive')}</Badge>
                  </td>
                  <td>
                    {can('hr:edit') && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        {t('common.edit')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </DataState>
      <LeaveTypeDialog type={editing} onClose={() => setEditing(null)} onSaved={q.reload} />
    </Section>
  );
}

function LeaveTypeDialog({ type, onClose, onSaved }: { type: LeaveType | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ nameAr: '', nameEn: '', paid: true, quota: '', maxConsecutive: '', isActive: true });
  const a = useAction();
  useEffect(() => {
    if (type)
      setF({
        nameAr: type.name_ar,
        nameEn: type.name_en,
        paid: type.paid,
        quota: type.annual_quota === null ? '' : String(num(type.annual_quota)),
        maxConsecutive: type.max_consecutive_days === null ? '' : String(num(type.max_consecutive_days)),
        isActive: type.is_active,
      });
    a.setError(null);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={!!type} onClose={onClose} title={t('hr.set.editLeaveType')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!type) return;
          const quota = f.quota.trim() === '' ? null : Number(f.quota);
          const max = f.maxConsecutive.trim() === '' ? null : Number(f.maxConsecutive);
          if ((quota !== null && !(quota >= 0 && quota <= 365)) || (max !== null && !(max >= 0.5 && max <= 365))) return a.setError(t('hr.set.range', { min: 0, max: 365 }));
          const r = await a.run(() => patch(`/hr/leave-types/${type.id}`, { nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim(), paid: f.paid, annualQuota: quota, maxConsecutiveDays: max, isActive: f.isActive }));
          if (r) {
            toast(t('common.saved'));
            onSaved();
            onClose();
          }
        }}
      >
        <TextField label={t('hr.set.nameAr')} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} dir="rtl" required minLength={2} />
        <TextField label={t('hr.set.nameEn')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('hr.set.quota')} type="number" min={0} max={365} step={0.5} value={f.quota} onChange={(e) => setF({ ...f, quota: e.target.value })} hint={t('hr.set.emptyNoLimit')} />
          <TextField label={t('hr.set.maxConsecutive')} type="number" min={0.5} max={365} step={0.5} value={f.maxConsecutive} onChange={(e) => setF({ ...f, maxConsecutive: e.target.value })} hint={t('hr.set.emptyNoLimit')} />
        </div>
        <Check label={t('hr.set.paid')} checked={f.paid} onChange={(v) => setF({ ...f, paid: v })} />
        <Check label={t('common.active')} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
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
    </Dialog>
  );
}

// ---- Clock-in location ----------------------------------------------------------------------------------------

const CIDR_RE = /^[0-9a-fA-F:.]+\/\d{1,3}$/;
const MODES = ['off', 'flag', 'block'] as const;

/** Per-clinic proof of presence for clocking in and out (GET/PUT /hr/clinics/:clinicId/attendance-rules). */
function ClockLocation() {
  const { t } = useI18n();
  const { me } = useSession();
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('hr.loc.title')}>
        <div className="flex flex-col gap-2 text-sm">
          <p>{t('hr.loc.intro')}</p>
          <ul className="flex list-disc flex-col gap-1 ps-5">
            <li>{t('hr.loc.introNetwork')}</li>
            <li>{t('hr.loc.introRadius')}</li>
            <li>{t('hr.loc.introFlag')}</li>
            <li>{t('hr.loc.introBlock')}</li>
          </ul>
          <Alert tone="info">{t('hr.loc.recommend')}</Alert>
        </div>
      </Section>
      {me.clinics.length === 0 && <p className="text-sm text-muted">{t('common.empty')}</p>}
      {me.clinics.map((c) => (
        <ClinicRules key={c.id} clinic={c} />
      ))}
    </div>
  );
}

const MODE_TONE = { off: 'neutral', flag: 'warning', block: 'danger' } as const;

function ClinicRules({ clinic }: { clinic: Clinic }) {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<AttendanceRules>(`/hr/clinics/${clinic.id}/attendance-rules`);
  const [f, setF] = useState<{ mode: AttendanceRules['mode']; networks: string; radius: string } | null>(null);
  const [errors, setErrors] = useState<{ networks?: string; radius?: string }>({});
  const a = useAction();
  const edit = can('hr:edit');
  useEffect(() => {
    if (q.data) setF({ mode: q.data.mode, networks: q.data.allowedNetworks.join('\n'), radius: q.data.geofenceMeters === null ? '' : String(q.data.geofenceMeters) });
  }, [q.data]);
  const hasLocation = !!q.data?.clinicHasLocation;
  return (
    <Section title={biName(clinic, locale)} actions={q.data && <Badge tone={MODE_TONE[q.data.mode]}>{t(`hr.loc.mode.${q.data.mode}`)}</Badge>}>
      <DataState loading={q.loading} error={q.error} data={f ?? undefined}>
        {(x) => {
          const networks = x.networks.split(/[\n,]+/).map(normaliseNetwork).filter(Boolean);
          const radiusOnlyBlock = x.mode === 'block' && networks.length === 0 && x.radius.trim() !== '';
          return (
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                const errs: typeof errors = {};
                const bad = networks.find((n) => !CIDR_RE.test(n));
                if (bad) errs.networks = t('err.invalid_network', { network: bad });
                else if (networks.length > 20) errs.networks = t('hr.loc.tooMany', { n: 20 });
                const radius = x.radius.trim() === '' ? null : Number(x.radius);
                if (radius !== null && !(Number.isInteger(radius) && radius >= 25 && radius <= 2000)) errs.radius = t('hr.set.range', { min: 25, max: 2000 });
                else if (radius !== null && !hasLocation) errs.radius = t('err.clinic_location_missing');
                setErrors(errs);
                if (errs.networks || errs.radius) return a.setError(null);
                if (x.mode !== 'off' && networks.length === 0 && radius === null) return a.setError(t('err.no_location_rule'));
                const r = await a.run(() => put<AttendanceRules>(`/hr/clinics/${clinic.id}/attendance-rules`, { mode: x.mode, allowedNetworks: networks, geofenceMeters: radius }));
                if (r) {
                  toast(t('common.saved'));
                  q.setData({ ...r, clinicHasLocation: hasLocation });
                }
              }}
            >
              <fieldset disabled={!edit} className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{t('hr.loc.modeLabel')}</legend>
                {MODES.map((m) => (
                  <label key={m} className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm has-[:checked]:border-primary">
                    <input type="radio" name={`mode-${clinic.id}`} className="mt-1 h-4 w-4" checked={x.mode === m} onChange={() => setF({ ...x, mode: m })} />
                    <span>
                      <span className="font-medium">{t(`hr.loc.mode.${m}`)}</span>
                      {m === 'flag' && (
                        <Badge tone="primary" className="ms-2">
                          {t('hr.loc.recommended')}
                        </Badge>
                      )}
                      <span className="block text-xs text-muted">{t(`hr.loc.modeHint.${m}`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset disabled={!edit} className="grid gap-4 md:grid-cols-2">
                <TextAreaField
                  label={t('hr.loc.networks')}
                  value={x.networks}
                  onChange={(e) => setF({ ...x, networks: e.target.value })}
                  hint={t('hr.loc.networksHint')}
                  error={errors.networks}
                  dir="ltr"
                  rows={3}
                  placeholder="197.32.10.0/24"
                />
                <div className="flex flex-col gap-2">
                  <TextField
                    label={t('hr.loc.radius')}
                    type="number"
                    min={25}
                    max={2000}
                    step={5}
                    value={x.radius}
                    onChange={(e) => setF({ ...x, radius: e.target.value })}
                    hint={t('hr.loc.radiusHint')}
                    error={errors.radius}
                    disabled={!hasLocation && x.radius.trim() === ''}
                    dir="ltr"
                  />
                  {!hasLocation && <p className="text-xs text-muted">{t('hr.loc.noClinicLocation')}</p>}
                </div>
              </fieldset>
              {radiusOnlyBlock && <Alert tone="warning">{t('hr.loc.blockRadiusOnly')}</Alert>}
              {x.mode === 'block' && networks.length > 0 && <Alert tone="warning">{t('hr.loc.blockWarn')}</Alert>}
              {a.error && <Alert tone="danger">{a.error}</Alert>}
              {!edit && <p className="text-xs text-muted">{t('hr.loc.readOnly')}</p>}
              {edit && (
                <div className="flex justify-end">
                  <Button type="submit" disabled={a.busy}>
                    {t('common.save')}
                  </Button>
                </div>
              )}
            </form>
          );
        }}
      </DataState>
    </Section>
  );
}
