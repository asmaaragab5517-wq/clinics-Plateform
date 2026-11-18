'use client';

import { useEffect, useState } from 'react';
import { Badge, Bdi, Button, Money, Stat, Table, cx } from '@hf/ui';
import { Check, SelectField, TextAreaField, TextField, InlineError } from './common';
import { Dialog } from './dialog';
import { useI18n } from './i18n';
import { put } from '@/lib/api';
import { biName, cairoTime, isoDate, num, time12 } from '@/lib/format';
import {
  STATE_TONE,
  WEEK,
  duration,
  fmtDay,
  monthDaysInfo,
  nextMonth,
  prevMonth,
  weekdayLabel,
  type AttendanceRecord,
  type Balances,
  type DayInfo,
  type MonthView,
  type PayslipLine,
  type WorkPattern,
} from '@/lib/hr';

/** Month selector with previous/next buttons (the native month input stays for direct entry). */
export function MonthPicker({ value, onChange, max }: { value: string; onChange: (m: string) => void; max?: string }) {
  const { t, dir } = useI18n();
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => onChange(prevMonth(value))} aria-label={t('hr.prevMonth')}>
        {dir === 'rtl' ? '›' : '‹'}
      </Button>
      <input
        type="month"
        className="h-8 rounded-xl border border-border bg-surface px-2 text-sm"
        value={value}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-label={t('hr.month')}
      />
      <Button size="sm" variant="ghost" onClick={() => onChange(nextMonth(value))} disabled={!!max && nextMonth(value) > max} aria-label={t('hr.nextMonth')}>
        {dir === 'rtl' ? '‹' : '›'}
      </Button>
    </div>
  );
}

export function StateBadge({ state }: { state: string }) {
  const { t } = useI18n();
  return <Badge tone={STATE_TONE[state] ?? 'neutral'}>{t(`hr.state.${state}`)}</Badge>;
}

/** Lateness, early leaving and overtime chips for one attendance record. */
export function RecordChips({ rec }: { rec: AttendanceRecord }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {num(rec.late_minutes) > 0 && <Badge tone="warning">{t('hr.lateBy', { d: duration(t, rec.late_minutes) })}</Badge>}
      {num(rec.early_leave_minutes) > 0 && <Badge tone="warning">{t('hr.earlyBy', { d: duration(t, rec.early_leave_minutes) })}</Badge>}
      {num(rec.overtime_minutes) > 0 && (
        <Badge tone={rec.overtime_approved ? 'success' : 'neutral'}>
          {t(rec.overtime_approved ? 'hr.otApproved' : 'hr.otPending', { d: duration(t, rec.overtime_minutes) })}
        </Badge>
      )}
      {rec.rest_day && <Badge tone="primary">{t('hr.restDayWork')}</Badge>}
      {rec.clock_in && !rec.clock_out && <Badge tone={rec.status === 'incomplete' ? 'danger' : 'neutral'}>{t(rec.status === 'incomplete' ? 'hr.missingOut' : 'hr.stillIn')}</Badge>}
      {rec.source === 'manual' && rec.adjusted_reason && (
        <Badge tone="neutral" title={rec.adjusted_reason}>
          {t('hr.corrected')}
        </Badge>
      )}
    </span>
  );
}

function SummaryStats({ v }: { v: MonthView }) {
  const { t, dir } = useI18n();
  // Stat values are isolated left-to-right; durations contain words, so give them the page direction.
  const d = (m: number) => <span dir={dir}>{duration(t, m)}</span>;
  const s = v.summary;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <Stat label={t('hr.sum.scheduled')} value={s.scheduledDays} />
      <Stat label={t('hr.sum.worked')} value={s.workedDays} hint={duration(t, s.workedMinutes)} />
      <Stat label={t('hr.sum.absent')} value={s.absentDays} />
      <Stat label={t('hr.sum.leave')} value={s.leaveDays} hint={s.unpaidLeaveDays ? t('hr.sum.unpaid', { n: s.unpaidLeaveDays }) : undefined} />
      <Stat label={t('hr.sum.lateness')} value={d(s.latenessMinutes)} />
      <Stat label={t('hr.sum.overtime')} value={d(s.overtimeMinutes + s.restDayOvertimeMinutes)} hint={s.restDayOvertimeMinutes ? t('hr.sum.restDayPart', { d: duration(t, s.restDayOvertimeMinutes) }) : undefined} />
      <Stat label={t('hr.sum.pendingOt')} value={d(s.pendingOvertimeMinutes)} hint={s.futureDays ? t('hr.sum.future', { n: s.futureDays }) : undefined} />
    </div>
  );
}

/** Calendar grid (Saturday first) of a month's day states. */
function MonthCalendar({ days, selected, onSelect }: { days: DayInfo[]; selected: string | null; onSelect: (d: string) => void }) {
  const { t } = useI18n();
  const first = days[0];
  const lead = first ? WEEK.indexOf(first.weekday) : 0;
  return (
    <div className="grid grid-cols-7 gap-1 text-xs" role="grid" aria-label={t('hr.calendar')}>
      {WEEK.map((d) => (
        <div key={d} role="columnheader" className="p-1 text-center font-medium text-muted">
          {weekdayLabel(t, d, true)}
        </div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div key={`lead${i}`} />
      ))}
      {days.map((d) => (
        <button
          key={d.date}
          type="button"
          role="gridcell"
          aria-selected={selected === d.date}
          onClick={() => onSelect(d.date)}
          className={cx(
            'flex min-h-16 flex-col items-start gap-0.5 rounded-lg border p-1 text-start',
            selected === d.date ? 'border-primary ring-1 ring-primary' : 'border-border',
            d.state === 'present' && 'bg-success/5',
            d.state === 'absent' && 'bg-danger/5',
            d.state === 'on_leave' && 'bg-primary/5',
            d.state === 'not_in_yet' && 'bg-warning/5',
            (d.state === 'rest_day' || d.state === 'holiday' || d.state === 'not_employed') && 'bg-bg text-muted',
          )}
          title={t(`hr.state.${d.state}`)}
        >
          <span className="num font-medium">{Number(d.date.slice(8))}</span>
          <span className="leading-tight">{t(`hr.state.${d.state}`)}</span>
          {d.rec && num(d.rec.late_minutes) > 0 && <span className="text-warning">{t('hr.lateShort', { n: d.rec.late_minutes })}</span>}
          {d.rec && num(d.rec.overtime_minutes) > 0 && <span className={d.rec.overtime_approved ? 'text-success' : 'text-muted'}>{t('hr.otShort', { n: d.rec.overtime_minutes })}</span>}
          {d.pendingLeave && <span className="text-warning">{t('hr.leavePendingShort')}</span>}
          {d.permissions.length > 0 && <span className="text-accent">{t('hr.permShort')}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * One person's month: summary, calendar and a day table. In team mode each day offers a correction and, for
 * overtime, approve/revoke (the API checks hr:edit / hr:approve).
 */
export function MonthSheet({
  view,
  today,
  onCorrect,
  onOvertime,
}: {
  view: MonthView;
  today: string;
  onCorrect?: (day: DayInfo) => void;
  onOvertime?: (rec: AttendanceRecord, approved: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const days = monthDaysInfo(view, today);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [view.month]);
  const rows = days.filter((d) => (selected ? d.date === selected : d.rec || d.holiday || d.leave || d.pendingLeave || d.permissions.length || d.state === 'absent' || d.state === 'not_in_yet'));
  if (!view.contract) return <p className="text-sm text-muted">{t('hr.noContractMonth')}</p>;
  return (
    <div className="flex flex-col gap-4">
      <SummaryStats v={view} />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <MonthCalendar days={days} selected={selected} onSelect={(d) => setSelected(selected === d ? null : d)} />
          <p className="mt-2 text-xs text-muted">{t('hr.calendarHint')}</p>
        </div>
        <div className="xl:col-span-3">
          {selected && (
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>{t('hr.showingDay', { d: fmtDay(selected) })}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                {t('hr.showAll')}
              </Button>
            </div>
          )}
          <Table>
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('common.status')}</th>
                <th>{t('hr.in')}</th>
                <th>{t('hr.out')}</th>
                <th>{t('hr.worked')}</th>
                <th>{t('hr.details')}</th>
                {(onCorrect || onOvertime) && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.date}>
                  <td className="whitespace-nowrap">
                    <span className="num">{fmtDay(d.date)}</span>
                    <span className="block text-xs text-muted">{weekdayLabel(t, d.weekday)}</span>
                  </td>
                  <td>
                    <StateBadge state={d.state} />
                  </td>
                  <td className="num whitespace-nowrap">{d.rec?.clock_in ? time12(d.rec.clock_in, locale) : '—'}</td>
                  <td className="num whitespace-nowrap">{d.rec?.clock_out ? time12(d.rec.clock_out, locale) : '—'}</td>
                  <td className="whitespace-nowrap">{d.rec?.clock_in ? duration(t, d.rec.worked_minutes) : '—'}</td>
                  <td className="text-xs">
                    <div className="flex flex-col gap-1">
                      {d.rec && <RecordChips rec={d.rec} />}
                      {d.holiday && <Bdi>{locale === 'en' ? d.holiday.name_en || d.holiday.name_ar : d.holiday.name_ar}</Bdi>}
                      {d.leave && <span>{locale === 'en' ? d.leave.name_en : d.leave.name_ar}</span>}
                      {d.pendingLeave && <span className="text-warning">{t('hr.leavePending', { type: locale === 'en' ? d.pendingLeave.name_en : d.pendingLeave.name_ar })}</span>}
                      {d.permissions.map((p) => (
                        <span key={p.id}>
                          {t(`hr.perm.${p.kind}`)} <bdi className="num">{p.start}–{p.end}</bdi> · {t(`hr.req.${p.status}`)}
                        </span>
                      ))}
                      {d.rec?.adjusted_reason && <span className="text-muted">{t('hr.correctionReason', { r: d.rec.adjusted_reason })}</span>}
                    </div>
                  </td>
                  {(onCorrect || onOvertime) && (
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {onCorrect && d.date <= today && d.state !== 'not_employed' && (
                          <Button size="sm" variant="ghost" onClick={() => onCorrect(d)}>
                            {t('hr.correct')}
                          </Button>
                        )}
                        {onOvertime && d.rec && num(d.rec.overtime_minutes) > 0 && (
                          <Button size="sm" variant={d.rec.overtime_approved ? 'ghost' : 'secondary'} onClick={() => onOvertime(d.rec!, !d.rec!.overtime_approved)}>
                            {t(d.rec.overtime_approved ? 'hr.otRevoke' : 'hr.otApprove')}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted">
                    {t('common.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/** Correct or create one day's attendance (PUT /hr/attendance, hr:edit); a reason is required and audited. */
export function CorrectionDialog({ target, onClose, onSaved }: { target: { userId: string; name: string; date: string; rec?: AttendanceRecord | null } | null; onClose: () => void; onSaved: () => void }) {
  const { t, err } = useI18n();
  const [f, setF] = useState({ clockIn: '', clockOut: '', status: 'absent', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    setError(null);
    setF({
      clockIn: target.rec?.clock_in ? cairoTime(target.rec.clock_in) : '',
      clockOut: target.rec?.clock_out ? cairoTime(target.rec.clock_out) : '',
      status: target.rec && ['absent', 'on_leave', 'holiday', 'rest_day'].includes(target.rec.status) ? target.rec.status : 'absent',
      reason: '',
    });
  }, [target]);
  if (!target) return null;
  return (
    <Dialog open={!!target} onClose={onClose} title={t('hr.correctTitle', { name: target.name, d: fmtDay(target.date) })}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (f.reason.trim().length < 3) return setError(t('form.reasonMin', { n: 3 }));
          if (f.clockOut && !f.clockIn) return setError(t('err.clock_out_without_clock_in'));
          setBusy(true);
          setError(null);
          try {
            await put('/hr/attendance', { userId: target.userId, workDate: isoDate(target.date), clockIn: f.clockIn || null, clockOut: f.clockOut || null, status: f.clockIn ? undefined : f.status, reason: f.reason.trim() });
            onSaved();
            onClose();
          } catch (x) {
            setError(err(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('hr.in')} type="time" value={f.clockIn} onChange={(e) => setF({ ...f, clockIn: e.target.value })} />
          <TextField label={t('hr.out')} type="time" value={f.clockOut} onChange={(e) => setF({ ...f, clockOut: e.target.value })} hint={t('hr.outNextDayHint')} />
        </div>
        {!f.clockIn && (
          <SelectField
            label={t('hr.dayStatus')}
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value })}
            options={['absent', 'on_leave', 'holiday', 'rest_day'].map((s) => ({ value: s, label: t(`hr.state.${s}`) }))}
          />
        )}
        <p className="text-xs text-muted">{t('hr.correctHint')}</p>
        <TextAreaField label={t('form.reason')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} />
        <InlineError text={error} />
        <div className="flex justify-end gap-2">
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

/** Weekday checkboxes (Saturday first) with start and end times. */
export function WorkPatternEditor({ value, onChange }: { value: WorkPattern; onChange: (p: WorkPattern) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-medium">{t('hr.workPattern')}</legend>
      <div className="flex flex-wrap gap-3">
        {WEEK.map((d) => (
          <Check key={d} label={weekdayLabel(t, d)} checked={value.days.includes(d)} onChange={(c) => onChange({ ...value, days: c ? [...value.days, d].sort() : value.days.filter((x) => x !== d) })} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label={t('hr.shiftStart')} type="time" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} required />
        <TextField label={t('hr.shiftEnd')} type="time" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} required />
      </div>
    </fieldset>
  );
}

/** Payslip lines grouped as earnings, deductions and employer contributions. */
export function PayslipLines({ lines }: { lines: PayslipLine[] }) {
  const { t, locale } = useI18n();
  const groups: PayslipLine['kind'][] = ['earning', 'deduction', 'employer'];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {groups.map((g) => {
        const ls = lines.filter((l) => l.kind === g);
        return (
          <div key={g} className="rounded-lg border border-border p-2">
            <p className="mb-1 text-xs font-semibold text-muted">{t(`pay.kind.${g}`)}</p>
            {ls.length === 0 && <p className="text-xs text-muted">—</p>}
            <ul className="flex flex-col gap-1 text-sm">
              {ls.map((l, i) => (
                <li key={`${l.code}${i}`} className="flex items-baseline justify-between gap-2">
                  <span>
                    {locale === 'en' ? l.labelEn || l.labelAr : l.labelAr}
                    {l.basis && (
                      <span className="ms-1 text-xs text-muted">
                        (<bdi className="num">{l.basis}</bdi>)
                      </span>
                    )}
                  </span>
                  <span className={cx('whitespace-nowrap', g === 'deduction' && 'text-danger')}>
                    <Money value={num(l.amount)} locale={locale} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Annual leave pool and per-type usage. */
export function BalanceView({ b }: { b: Balances }) {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm text-muted">{t('hr.balance.available', { year: b.year })}</p>
        <p className="num text-3xl font-bold">{num(b.annual.available)}</p>
        <p className="text-xs text-muted">{t('hr.balance.breakdown', { entitled: num(b.annual.entitled), carried: num(b.annual.carried), adjusted: num(b.annual.adjusted), used: num(b.annual.used), pending: num(b.annual.pending) })}</p>
        <p className="mt-1 text-xs text-muted">{t('hr.balance.poolHint')}</p>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {b.types
          .filter((x) => x.annual_quota !== null || num(x.used) > 0)
          .map((x) => (
            <li key={x.id} className="flex justify-between gap-2">
              <span>{biName(x, locale)}</span>
              <span className="text-muted">{x.annual_quota !== null ? t('hr.balance.usedOf', { used: num(x.used), quota: num(x.annual_quota) }) : t('hr.balance.used', { used: num(x.used) })}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Reload a query when a version counter changes (after a related mutation elsewhere on the page). */
export function useReloadOn(version: number, reload: () => void) {
  useEffect(() => {
    if (version) reload();
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
}
