import { addDays, localDate, startOfWeek, weekdayOf, zonedToUtc, type Locale } from '@hf/shared';
import type { TKey } from './i18n';
import { time } from './format';
import type { AttendanceRecord, HrContract, HrMonth, HrRequestStatus, PayslipLine, WorkPattern } from './types';

/** Staff HR display helpers (attendance, leave and payslips). Dates are Cairo calendar days (YYYY-MM-DD). */
type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

export const todayCairo = () => localDate(new Date());

/** YYYY-MM of the month before / after. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const monthLabel = (month: string, t: Translate) => `${t(`hr.monthName.${Number(month.slice(5, 7))}` as TKey)} ${month.slice(0, 4)}`;
export const weekdayName = (day: string, t: Translate) => t(`hr.weekday.${weekdayOf(day)}` as TKey);

/** "1 h 20 min", "45 min", "3 h". */
export function minutesText(n: number, t: Translate): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return t('hr.min', { m });
  return m ? t('hr.hourMin', { h, m }) : t('hr.hours', { h });
}

/** A Cairo wall-clock time (HH:MM, optionally :SS) on a day, shown like other times in the app (12-hour). */
export const wallTime = (day: string, hhmm: string, locale: Locale) => time(zonedToUtc(day, hhmm.slice(0, 5)), locale);

export const isWorkDay = (pattern: WorkPattern, day: string) => pattern.days.includes(weekdayOf(day));

export const jobTitle = (c: HrContract, locale: Locale) => (locale === 'en' && c.job_title_en) || c.job_title_ar;

export const requestTone = (s: HrRequestStatus): 'info' | 'warn' | 'danger' | 'success' =>
  s === 'approved' ? 'success' : s === 'pending' ? 'warn' : s === 'rejected' ? 'danger' : 'info';

/** Own requests can be cancelled while pending, or once approved until the day they start (hr.ts `cancel`). */
export const canCancel = (status: HrRequestStatus, startDay: string, today: string) => status === 'pending' || (status === 'approved' && startDay > today);

export const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** "1 day", "2 days", "3 days" with Arabic dual and plural forms; leave days can be halves (numeric(6,2)). */
export function daysText(v: number | string, t: Translate): string {
  const n = Math.round((num(v) ?? 0) * 10) / 10;
  if (n === 1) return t('hr.days.one');
  if (n === 2) return t('hr.days.two');
  return Number.isInteger(n) && n >= 3 && n <= 10 ? t('hr.days.few', { n }) : t('hr.days', { n });
}

// ---- My month --------------------------------------------------------------------------------------------------

export type DayKind = 'present' | 'open' | 'incomplete' | 'absent' | 'on_leave' | 'holiday' | 'rest_day' | 'not_in_yet' | 'upcoming';
export interface DayRow {
  day: string;
  kind: DayKind;
  record: AttendanceRecord | null;
  holiday: string | null;
  leave: HrMonth['leave'][number] | null;
  pendingLeave: HrMonth['leave'][number] | null;
  permissions: HrMonth['permissions'];
}

export const dayTone = (k: DayKind): 'info' | 'warn' | 'danger' | 'success' =>
  k === 'present' ? 'success' : k === 'absent' || k === 'incomplete' ? 'danger' : k === 'open' || k === 'not_in_yet' ? 'warn' : 'info';

/**
 * One row per calendar day of the month the person was employed, newest first. Only days that have happened are
 * listed, plus future days with leave, a holiday or a permission. The API returns attendance records only, so rest
 * days and holidays are derived from the contract's work pattern and the month's holidays.
 */
export function monthDays(m: HrMonth, today: string, pick: (o: { name_ar?: string | null; name_en?: string | null }) => string): DayRow[] {
  const c = m.contract;
  const first = `${m.month}-01`;
  const last = addDays(`${shiftMonth(m.month, 1)}-01`, -1);
  const rec = new Map(m.days.map((d) => [d.day, d]));
  const hol = new Map(m.holidays.map((h) => [h.day, pick(h)]));
  const rows: DayRow[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const r = rec.get(d) ?? null;
    if (!r && c && (d < c.start_date.slice(0, 10) || (c.end_date && d > c.end_date.slice(0, 10)))) continue;
    if (!r && !c) continue;
    const leaves = m.leave.filter((l) => l.start_date <= d && l.end_date >= d);
    const leave = leaves.find((l) => l.status === 'approved') ?? null;
    const pendingLeave = leaves.find((l) => l.status === 'pending') ?? null;
    const permissions = m.permissions.filter((p) => p.day === d);
    const holiday = hol.get(d) ?? null;
    const scheduled = c ? isWorkDay(c.work_pattern, d) : true;
    let kind: DayKind;
    if (r?.clock_in) kind = r.clock_out ? 'present' : d < today ? 'incomplete' : 'open';
    else if (holiday !== null || r?.status === 'holiday') kind = 'holiday';
    else if (leave || r?.status === 'on_leave') kind = 'on_leave';
    else if (r?.status === 'rest_day' || !scheduled) kind = 'rest_day';
    else if (r?.status === 'absent' || d < today) kind = 'absent';
    else kind = d === today ? 'not_in_yet' : 'upcoming';
    if (d > today && kind !== 'holiday' && kind !== 'on_leave' && !pendingLeave && !permissions.length) continue;
    rows.push({ day: d, kind, record: r, holiday, leave, pendingLeave, permissions });
  }
  return rows.reverse();
}

/** Saturday that starts the week of a day (the clinic week runs Saturday to Friday). */
export const weekOf = (day: string) => startOfWeek(day);

// ---- Payslips --------------------------------------------------------------------------------------------------

export const lineLabel = (l: PayslipLine, locale: Locale) => (locale === 'en' ? l.labelEn || l.labelAr : l.labelAr || l.labelEn);

/** The payroll engine writes bases in English units ("3 d", "125 min", "4.5 h"); percentages and "12/30" pass through. */
export function basisText(basis: string | undefined, t: Translate): string | null {
  if (!basis) return null;
  const m = /^(\d+(?:\.\d+)?) (d|min|h)$/.exec(basis.trim());
  if (!m) return basis;
  const n = Number(m[1]);
  return m[2] === 'd' ? daysText(n, t) : m[2] === 'h' ? t('hr.hours', { h: n }) : minutesText(n, t);
}
