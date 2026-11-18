'use client';

import { useEffect, useState } from 'react';
import { Badge, Bdi, Button, Money, Stat, Table, cx } from '@hf/ui';
import { Check, SelectField, TextAreaField, TextField, InlineError } from './common';
import { Dialog } from './dialog';
import { useI18n } from './i18n';
import { put } from '@/lib/api';
import { biName, cairoDate, cairoTime, isoDate, num, time12 } from '@/lib/format';
import {
  OT_TONE,
  STATE_TONE,
  WEEK,
  duration,
  MAX_PUNCHES,
  fmtDay,
  lineQuantity,
  recordPunches,
  monthDaysInfo,
  nextMonth,
  otStatus,
  paidMinutes,
  prevMonth,
  weekdayLabel,
  type AttendanceRecord,
  type LocationCheck,
  type LocationCheckDetail,
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

const CHECK_TONE: Record<LocationCheck, 'success' | 'danger' | 'warning'> = { ok: 'success', outside: 'danger', unverified: 'warning' };

/** Plain words for a clock-in/out location verdict: how it was verified, or how far away the device was. */
function checkText(t: ReturnType<typeof useI18n>['t'], check: LocationCheck, d: LocationCheckDetail | null | undefined): { label: string; title: string } {
  const m = Math.round(num(d?.distance));
  if (check === 'ok')
    return d?.method === 'gps'
      ? { label: t('hr.loc.okGps', { m }), title: t('hr.loc.okGpsTitle', { m, a: Math.round(num(d.accuracy)) }) }
      : { label: t('hr.loc.okNetwork'), title: t('hr.loc.okNetworkTitle') };
  if (check === 'outside') return { label: d?.distance !== undefined ? t('hr.loc.outside', { m }) : t('hr.loc.outsideNoDistance'), title: t('hr.loc.outsideTitle') };
  return { label: t('hr.loc.unverified'), title: t(d?.method === 'gps_unavailable' ? 'hr.loc.unverifiedGpsTitle' : 'hr.loc.unverifiedTitle') };
}

/** Small badges for the clock-in and clock-out location checks; nothing when the clinic does not check location. */
export function LocationBadges({ rec }: { rec: AttendanceRecord }) {
  const { t } = useI18n();
  const items = [
    { when: t('hr.in'), check: rec.clock_in_check, detail: rec.clock_in_check_detail },
    { when: t('hr.out'), check: rec.clock_out_check, detail: rec.clock_out_check_detail },
  ];
  return (
    <>
      {items.map((x) => {
        if (!x.check) return null;
        const { label, title } = checkText(t, x.check, x.detail);
        return (
          <Badge key={x.when} tone={CHECK_TONE[x.check]} title={title}>
            {t('hr.loc.badge', { when: x.when, what: label })}
          </Badge>
        );
      })}
    </>
  );
}

/** Every clock-in/out pair of a day: "In 09:02 · Out 13:00 · In 17:05". */
export function PunchList({ rec, className }: { rec: AttendanceRecord; className?: string }) {
  const { t, locale } = useI18n();
  const pairs = recordPunches(rec);
  if (!pairs.length) return null;
  const items: string[] = [];
  for (const p of pairs) {
    items.push(t('hr.punch.in', { t: time12(p.in, locale) }));
    if (p.out) items.push(t('hr.punch.out', { t: time12(p.out, locale) }));
  }
  return (
    <span className={cx('num', className)} title={t('hr.punch.title', { n: pairs.length })}>
      {items.join(' · ')}
    </span>
  );
}

/** Overtime length with its night part, e.g. "1 h 30 min, 60 min at night". */
export function otDuration(t: ReturnType<typeof useI18n>['t'], rec: AttendanceRecord): string {
  const night = num(rec.overtime_night_minutes);
  return night > 0 ? t('hr.otWithNight', { d: duration(t, rec.overtime_minutes), n: duration(t, night) }) : duration(t, rec.overtime_minutes);
}

/** Lateness, early leaving, overtime and location chips for one attendance record. */
export function RecordChips({ rec }: { rec: AttendanceRecord }) {
  const { t } = useI18n();
  const ot = otStatus(rec);
  return (
    <span className="inline-flex flex-wrap gap-1">
      {num(rec.late_minutes) > 0 && <Badge tone="warning">{t('hr.lateBy', { d: duration(t, rec.late_minutes) })}</Badge>}
      {num(rec.early_leave_minutes) > 0 && <Badge tone="warning">{t('hr.earlyBy', { d: duration(t, rec.early_leave_minutes) })}</Badge>}
      {num(rec.overtime_minutes) > 0 && (
        <Badge tone={OT_TONE[ot]} title={ot === 'rejected' ? t('hr.otRejectedHint') : undefined}>
          {t(`hr.ot.${ot}`, { d: otDuration(t, rec) })}
        </Badge>
      )}
      <LocationBadges rec={rec} />
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
      <Stat
        label={t('hr.sum.overtime')}
        value={d(s.overtimeMinutes + s.restDayOvertimeMinutes)}
        hint={
          [
            num(s.nightOvertimeMinutes) > 0 ? t('hr.sum.nightPart', { d: duration(t, s.nightOvertimeMinutes) }) : null,
            s.restDayOvertimeMinutes ? t('hr.sum.restDayPart', { d: duration(t, s.restDayOvertimeMinutes) }) : null,
          ]
            .filter(Boolean)
            .join(t('common.listSep')) || undefined
        }
      />
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
          {d.rec && num(d.rec.overtime_minutes) > 0 && (
            <span className={cx(otStatus(d.rec) === 'approved' && 'text-success', otStatus(d.rec) === 'pending' && 'text-muted', otStatus(d.rec) === 'rejected' && 'text-danger line-through')}>
              {t('hr.otShort', { n: d.rec.overtime_minutes })}
              {num(d.rec.overtime_night_minutes) > 0 && <span className="block">{t('hr.otNightShort', { n: num(d.rec.overtime_night_minutes) })}</span>}
            </span>
          )}
          {d.rec && (d.rec.clock_in_check === 'outside' || d.rec.clock_out_check === 'outside') && <span className="text-danger">{t('hr.loc.outsideShort')}</span>}
          {d.rec && d.rec.clock_in_check !== 'outside' && d.rec.clock_out_check !== 'outside' && (d.rec.clock_in_check === 'unverified' || d.rec.clock_out_check === 'unverified') && (
            <span className="text-warning">{t('hr.loc.unverifiedShort')}</span>
          )}
          {d.pendingLeave && <span className="text-warning">{t('hr.leavePendingShort')}</span>}
          {d.permissions.length > 0 && <span className="text-accent">{t('hr.permShort')}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Overtime decision buttons: Approve and Reject while pending; once decided, one button to change the decision and
 * one to return it to pending (POST /hr/attendance/:id/overtime with approved true, false or null).
 */
export function OvertimeActions({ rec, onDecide, busy }: { rec: AttendanceRecord; onDecide: (rec: AttendanceRecord, approved: boolean | null) => void; busy?: boolean }) {
  const { t } = useI18n();
  const ot = otStatus(rec);
  if (ot === 'pending')
    return (
      <>
        <Button size="sm" variant="secondary" onClick={() => onDecide(rec, true)} disabled={busy} aria-label={t('hr.otApproveAria', { d: duration(t, rec.overtime_minutes) })}>
          {t('hr.otApprove')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDecide(rec, false)} disabled={busy} aria-label={t('hr.otRejectAria', { d: duration(t, rec.overtime_minutes) })}>
          {t('hr.otReject')}
        </Button>
      </>
    );
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => onDecide(rec, ot !== 'approved')} disabled={busy} title={rec.overtime_decided_at ? t('hr.otDecidedOn', { d: fmtDay(cairoDate(rec.overtime_decided_at)) }) : undefined}>
        {t(ot === 'approved' ? 'hr.otChangeToRejected' : 'hr.otChangeToApproved')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onDecide(rec, null)} disabled={busy} title={t('hr.otToPendingHint')}>
        {t('hr.otToPending')}
      </Button>
    </>
  );
}

/**
 * One person's month: summary, calendar and a day table. In team mode each day offers a correction and, for
 * overtime, approve/reject (the API checks hr:edit / hr:approve).
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
  onOvertime?: (rec: AttendanceRecord, approved: boolean | null) => void;
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
                      {d.rec && recordPunches(d.rec).length > 1 && <PunchList rec={d.rec} />}
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
                        {onOvertime && d.rec && num(d.rec.overtime_minutes) > 0 && <OvertimeActions rec={d.rec} onDecide={onOvertime} />}
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

/**
 * Correct or create one day's attendance (PUT /hr/attendance with `punches`, hr:edit): one row per clock-in/out pair,
 * prefilled from the record. Only the last pair may lack a clock-out; a time earlier than the one before it is the
 * next day. A reason is required and audited.
 */
export function CorrectionDialog({ target, onClose, onSaved }: { target: { userId: string; name: string; date: string; rec?: AttendanceRecord | null } | null; onClose: () => void; onSaved: () => void }) {
  const { t, err } = useI18n();
  const [pairs, setPairs] = useState<{ in: string; out: string }[]>([]);
  const [status, setStatus] = useState('absent');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    setError(null);
    const rec = target.rec;
    setPairs(rec ? recordPunches(rec).map((p) => ({ in: cairoTime(p.in), out: p.out ? cairoTime(p.out) : '' })) : []);
    setStatus(rec && ['absent', 'on_leave', 'holiday', 'rest_day'].includes(rec.status) ? rec.status : 'absent');
    setReason('');
  }, [target]);
  if (!target) return null;
  const setPair = (i: number, p: Partial<{ in: string; out: string }>) => setPairs(pairs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Dialog open={!!target} onClose={onClose} title={t('hr.correctTitle', { name: target.name, d: fmtDay(target.date) })}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (reason.trim().length < 3) return setError(t('form.reasonMin', { n: 3 }));
          const used = pairs.filter((p) => p.in || p.out);
          if (used.some((p) => !p.in)) return setError(t('err.clock_out_without_clock_in'));
          if (used.slice(0, -1).some((p) => !p.out)) return setError(t('err.only_last_pair_may_be_open'));
          setBusy(true);
          setError(null);
          try {
            await put('/hr/attendance', {
              userId: target.userId,
              workDate: isoDate(target.date),
              ...(used.length ? { punches: used.map((p) => ({ in: p.in, out: p.out || null })) } : { clockIn: null, clockOut: null, status }),
              reason: reason.trim(),
            });
            onSaved();
            onClose();
          } catch (x) {
            setError(err(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('hr.punch.pairs')}</legend>
          {pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <TextField label={t('hr.punch.inN', { n: i + 1 })} type="time" value={p.in} onChange={(e) => setPair(i, { in: e.target.value })} />
              <TextField label={t('hr.punch.outN', { n: i + 1 })} type="time" value={p.out} onChange={(e) => setPair(i, { out: e.target.value })} />
              <Button type="button" size="sm" variant="ghost" onClick={() => setPairs(pairs.filter((_, j) => j !== i))} aria-label={t('hr.punch.removeAria', { n: i + 1 })}>
                {t('common.remove')}
              </Button>
            </div>
          ))}
          {pairs.length < MAX_PUNCHES && (
            <div>
              <Button type="button" size="sm" variant="secondary" onClick={() => setPairs([...pairs, { in: '', out: '' }])}>
                {t('hr.punch.add')}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted">{t('hr.punch.correctHint')}</p>
        </fieldset>
        {!pairs.some((p) => p.in || p.out) && (
          <SelectField
            label={t('hr.dayStatus')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={['absent', 'on_leave', 'holiday', 'rest_day'].map((s) => ({ value: s, label: t(`hr.state.${s}`) }))}
          />
        )}
        <p className="text-xs text-muted">{t('hr.correctHint')}</p>
        <TextAreaField label={t('form.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
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
  const hasBreak = value.breakStart !== undefined || value.breakEnd !== undefined;
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
      <Check
        label={t('hr.pattern.break')}
        checked={hasBreak}
        onChange={(on) => onChange(on ? { ...value, breakStart: value.breakStart ?? '13:00', breakEnd: value.breakEnd ?? '14:00' } : { days: value.days, start: value.start, end: value.end })}
        hint={t('hr.pattern.breakHint')}
      />
      {hasBreak && (
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('hr.pattern.breakStart')} type="time" value={value.breakStart ?? ''} onChange={(e) => onChange({ ...value, breakStart: e.target.value })} required />
          <TextField label={t('hr.pattern.breakEnd')} type="time" value={value.breakEnd ?? ''} onChange={(e) => onChange({ ...value, breakEnd: e.target.value })} required />
        </div>
      )}
      {value.end > value.start && <p className="text-xs text-muted">{t('hr.pattern.paidDay', { d: duration(t, paidMinutes(value)) })}</p>}
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
              {ls.map((l, i) => {
                const q = lineQuantity(t, l);
                return (
                  <li key={`${l.code}${i}`} className="flex items-baseline justify-between gap-2">
                    <span>
                      {locale === 'en' ? l.labelEn || l.labelAr : l.labelAr || l.labelEn}
                      {q.text && <span className="ms-1 text-xs text-muted">({q.text})</span>}
                      {q.note && (
                        <span className="block text-xs text-muted">
                          <Bdi>{q.note}</Bdi>
                        </span>
                      )}
                    </span>
                    <span className={cx('whitespace-nowrap', g === 'deduction' && 'text-danger')}>
                      <Money value={num(l.amount)} locale={locale} />
                    </span>
                  </li>
                );
              })}
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
