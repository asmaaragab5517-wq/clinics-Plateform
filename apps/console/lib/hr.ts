import { addDays, formatDate, weekdayOf, WEEK_ORDER } from '@hf/shared';
import { isoDate, num } from './format';
import type { T } from './i18n';

/** Shapes returned by `/v1/hr/*` and `/v1/payroll/*` (Sprint 19). Numeric columns may arrive as strings. */

export interface HrStaffRow {
  id: string;
  name_ar: string;
  name_en: string;
  email: string | null;
  status: string;
  roles: string[];
  contract: ContractView | null;
}

export interface WorkPattern {
  days: number[];
  start: string;
  end: string;
}

export interface Allowance {
  code: string;
  nameAr: string;
  nameEn: string;
  amount: number;
  taxable: boolean;
}

/** Contract as the API shows it; the pay fields are present only for payroll:view (or for your own contract). */
export interface ContractView {
  id: string;
  user_id: string;
  clinic_id: string;
  job_title_ar: string;
  job_title_en: string;
  employment_type: 'full_time' | 'part_time' | 'contractor';
  pay_basis: 'monthly' | 'hourly' | 'commission_only';
  start_date: string;
  end_date: string | null;
  work_pattern: WorkPattern;
  status: 'active' | 'ended';
  base_salary?: number;
  allowances?: Allowance[];
  insurable_wage?: number | null;
  social_insurance_number?: string | null;
  bank_name?: string | null;
  iban_last4?: string | null;
  date_of_birth?: string | null;
}

export interface AttendanceRecord {
  id: string;
  user_id: string;
  work_date: string;
  day?: string;
  clock_in: string | null;
  clock_out: string | null;
  source: string;
  status: string;
  late_minutes: number;
  early_leave_minutes: number;
  worked_minutes: number;
  overtime_minutes: number;
  rest_day: boolean;
  overtime_approved: boolean;
  adjusted_reason: string | null;
}

export interface MonthSummary {
  periodDays: number;
  employedDays: number;
  scheduledDays: number;
  workedDays: number;
  workedMinutes: number;
  absentDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  latenessMinutes: number;
  overtimeMinutes: number;
  restDayOvertimeMinutes: number;
  pendingOvertimeMinutes: number;
  futureDays: number;
}

export interface MonthView {
  month: string;
  contract: ContractView | null;
  summary: MonthSummary | null;
  days: AttendanceRecord[];
  leave: { id: string; start_date: string; end_date: string; days: number | string; status: string; code: string; name_ar: string; name_en: string }[];
  permissions: { id: string; day: string; start: string; end: string; kind: string; minutes: number; status: string }[];
  holidays: { day: string; name_ar: string; name_en: string }[];
}

export interface LeaveType {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  paid: boolean;
  uses_annual_balance: boolean;
  annual_quota: number | string | null;
  max_consecutive_days: number | string | null;
  is_active: boolean;
}

export interface AnnualBalance {
  balanceId: string | null;
  year: number;
  entitled: number;
  carried: number;
  adjusted: number;
  used: number;
  pending: number;
  available: number;
}

export interface Balances {
  year: number;
  annual: AnnualBalance;
  types: { id: string; code: string; name_ar: string; name_en: string; paid: boolean; uses_annual_balance: boolean; annual_quota: number | string | null; used: number }[];
}

export interface LeaveRequest {
  id: string;
  user_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number | string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decision_note: string | null;
  created_at: string;
  code: string;
  name_ar?: string;
  name_en?: string;
  type_name_ar?: string;
  type_name_en?: string;
}

export interface PermissionRequest {
  id: string;
  user_id: string;
  work_date: string;
  kind: string;
  start_time: string;
  end_time: string;
  minutes: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decision_note: string | null;
  created_at: string;
  name_ar?: string;
  name_en?: string;
}

export interface PayslipLine {
  code: string;
  labelAr: string;
  labelEn: string;
  amount: number;
  kind: 'earning' | 'deduction' | 'employer';
  basis?: string;
}

export interface HrSettings {
  graceMinutes: number;
  permissionsPerMonth: number;
  permissionMinutesPerMonth: number;
  deductLateness: boolean;
  overtimeMultiplier: number;
  restDayMultiplier: number;
  daysPerMonth: number;
  socialInsurance: { year: number; employeeRate: number; employerRate: number; minWage: number; maxWage: number };
  incomeTax: { personalExemption: number; brackets: { upTo: number | null; rate: number }[] };
  martyrsFundRate: number;
}

/** Weekdays in display order: the Egyptian week starts on Saturday (0 = Sunday … 6 = Saturday). */
export const WEEK = WEEK_ORDER as readonly number[];

export function weekdayLabel(t: T, d: number, short = false): string {
  return t(`${short ? 'hr.wdShort' : 'hr.wd'}.${d}`);
}

export function patternDays(t: T, p: WorkPattern | null | undefined): string {
  if (!p) return '';
  return WEEK.filter((d) => p.days.includes(d))
    .map((d) => weekdayLabel(t, d, true))
    .join(t('common.listSep'));
}

/** "1 h 25 min" style duration. */
export function duration(t: T, minutes: number | string | null | undefined): string {
  const m = Math.round(num(minutes));
  if (m < 60) return t('hr.mins', { n: m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('hr.hm', { h, m: r }) : t('hr.hours', { h });
}

/** A `YYYY-MM-DD` calendar date as dd/mm/yyyy (formatted at Cairo noon so the day never shifts). */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return '';
  return formatDate(new Date(`${isoDate(d)}T12:00:00Z`));
}

/** `YYYY-MM` as MM/YYYY (keeps its order inside right-to-left text). */
export function fmtMonth(m: string | null | undefined): string {
  if (!m) return '';
  return `${m.slice(5, 7)}/${m.slice(0, 4)}`;
}

export function daysOfMonth(month: string): string[] {
  const first = `${month}-01`;
  const out: string[] = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) out.push(d);
  return out;
}

export function prevMonth(month: string): string {
  return addDays(`${month}-01`, -1).slice(0, 7);
}

export function nextMonth(month: string): string {
  return addDays(`${month}-28`, 7).slice(0, 7);
}

export type DayState = 'present' | 'absent' | 'on_leave' | 'holiday' | 'rest_day' | 'not_in_yet' | 'future' | 'not_employed';

export interface DayInfo {
  date: string;
  weekday: number;
  state: DayState;
  rec?: AttendanceRecord;
  holiday?: { name_ar: string; name_en: string };
  leave?: MonthView['leave'][number];
  pendingLeave?: MonthView['leave'][number];
  permissions: MonthView['permissions'];
  scheduled: boolean;
}

/** Status of each day of a month from the records, the work pattern, leave and public holidays. */
export function monthDaysInfo(v: MonthView, today: string): DayInfo[] {
  const recs = new Map(v.days.map((r) => [isoDate(r.day ?? r.work_date), r]));
  const hol = new Map(v.holidays.map((h) => [isoDate(h.day), h]));
  const c = v.contract;
  return daysOfMonth(v.month).map((date) => {
    const weekday = weekdayOf(date);
    const rec = recs.get(date);
    const holiday = hol.get(date);
    const inLeave = (s: string) => v.leave.find((l) => l.status === s && isoDate(l.start_date) <= date && isoDate(l.end_date) >= date);
    const leave = inLeave('approved');
    const pendingLeave = inLeave('pending');
    const permissions = v.permissions.filter((p) => isoDate(p.day) === date);
    const employed = !!c && isoDate(c.start_date) <= date && (!c.end_date || isoDate(c.end_date) >= date);
    const scheduled = employed && !holiday && !!c?.work_pattern.days.includes(weekday);
    let state: DayState;
    if (rec?.clock_in) state = 'present';
    else if (holiday) state = 'holiday';
    else if (leave) state = 'on_leave';
    else if (rec && ['absent', 'on_leave', 'holiday', 'rest_day'].includes(rec.status)) state = rec.status as DayState;
    else if (!employed) state = 'not_employed';
    else if (!scheduled) state = 'rest_day';
    else if (date > today) state = 'future';
    else if (date === today) state = 'not_in_yet';
    else state = 'absent';
    return { date, weekday, state, rec, holiday, leave, pendingLeave, permissions, scheduled };
  });
}

export const STATE_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  present: 'success',
  not_in_yet: 'warning',
  absent: 'danger',
  on_leave: 'primary',
  rest_day: 'neutral',
  holiday: 'neutral',
  future: 'neutral',
  not_employed: 'neutral',
};

export const REQUEST_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export const RUN_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  draft: 'warning',
  approved: 'primary',
  paid: 'success',
  cancelled: 'neutral',
};

export const IBAN_RE = /^EG\d{27}$/;

/** Normalise a typed IBAN: drop spaces, upper-case, Arabic-Indic digits to ASCII. */
export function cleanIban(v: string): string {
  return v
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** Fraction ↔ percent without floating noise (0.1875 ↔ 18.75). */
export const toPercent = (f: number) => Math.round(f * 100 * 1e6) / 1e6;
export const fromPercent = (p: number) => Math.round((p / 100) * 1e8) / 1e8;
