import { addDays, formatDate, WEEK_ORDER, weekdayOf } from '@hf/shared/datetime';
import { basisQuantity } from '@hf/shared/hr';
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
  /** Optional unpaid break inside the day (split shift, Sprint 21): both or neither, strictly inside start–end. */
  breakStart?: string;
  breakEnd?: string;
}

/** One clock-in/out pair (ISO times); only the day's last pair may be open. */
export interface Punch {
  in: string;
  out: string | null;
}

/** Most clock-in/out pairs a day can hold (the API answers too_many_clock_ins beyond this). */
export const MAX_PUNCHES = 6;

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
  /** First arrival and last departure (null while a pair is open). */
  clock_in: string | null;
  clock_out: string | null;
  /** Every clock-in/out pair of the day (Sprint 21); older responses have only clock_in/clock_out. */
  punches?: Punch[] | null;
  source: string;
  status: string;
  late_minutes: number;
  early_leave_minutes: number;
  worked_minutes: number;
  overtime_minutes: number;
  /** Part of `overtime_minutes` inside the night window (Sprint 21; paid at the night multiplier). */
  overtime_night_minutes?: number;
  rest_day: boolean;
  overtime_approved: boolean;
  /** Explicit overtime decision (Sprint 20); a rejected decision is not paid and payroll no longer warns about it. */
  overtime_status?: OvertimeStatus;
  overtime_decided_by?: string | null;
  overtime_decided_at?: string | null;
  adjusted_reason: string | null;
  /** Clock-in location verdicts; null when the clinic does not check location. */
  clock_in_check?: LocationCheck | null;
  clock_in_check_detail?: LocationCheckDetail | null;
  clock_out_check?: LocationCheck | null;
  clock_out_check_detail?: LocationCheckDetail | null;
}

export type OvertimeStatus = 'pending' | 'approved' | 'rejected';
export type LocationCheck = 'ok' | 'outside' | 'unverified';
export interface LocationCheckDetail {
  method?: 'network' | 'gps' | 'none' | 'gps_unavailable';
  distance?: number;
  accuracy?: number;
}

/** Overtime decision, falling back to the Sprint 19 boolean for records the API returns without a status. */
export const otStatus = (r: AttendanceRecord): OvertimeStatus => r.overtime_status ?? (r.overtime_approved ? 'approved' : 'pending');

export const OT_TONE: Record<OvertimeStatus, 'neutral' | 'success' | 'danger'> = { pending: 'neutral', approved: 'success', rejected: 'danger' };

/** Per-clinic clock-in location rules (GET/PUT /hr/clinics/:clinicId/attendance-rules). */
export interface AttendanceRules {
  mode: 'off' | 'flag' | 'block';
  allowedNetworks: string[];
  geofenceMeters: number | null;
  clinicHasLocation?: boolean;
}

/** GET /hr/leave-preview: nulls where the leave type has no balance, quota or consecutive-day limit. */
export interface LeavePreview {
  days: number;
  available: number | null;
  remainingAfter: number | null;
  quota: number | null;
  quotaRemainingAfter: number | null;
  maxConsecutiveDays: number | null;
}

/** GET /hr/me `permissionAllowance`: this month's allowance and what is used (pending and approved). */
export interface PermissionAllowance {
  perMonth: number;
  minutesPerMonth: number;
  used: number;
  usedMinutes: number;
}

/** GET /payroll/people: contract holders payroll can act on (latest contract per person). */
export interface PayrollPerson {
  id: string;
  name_ar: string;
  name_en: string;
  job_title_ar: string;
  job_title_en: string;
  clinic_id: string;
  pay_basis: 'monthly' | 'hourly' | 'commission_only';
  status: 'active' | 'ended';
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
  /** Part of `overtimeMinutes` (approved) worked in the night window. */
  nightOvertimeMinutes?: number;
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
  /** English shorthand ("3 d", "125 min") or a free-text note (adjustments). */
  basis?: string;
  /** The same quantity as data (Sprint 21); absent for free-text notes and older payslips. */
  quantity?: PayslipQuantity;
}

export interface PayslipQuantity {
  value: number;
  unit: 'minutes' | 'days' | 'hours' | 'percent' | 'days_of';
  of?: number;
}

export interface HrSettings {
  graceMinutes: number;
  permissionsPerMonth: number;
  permissionMinutesPerMonth: number;
  deductLateness: boolean;
  overtimeMultiplier: number;
  restDayMultiplier: number;
  /** Overtime inside the night window (HH:MM, may wrap past midnight) is paid at this multiplier instead. */
  nightOvertimeMultiplier: number;
  nightStart: string;
  nightEnd: string;
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

/** The day's clock-in/out pairs, falling back to the first arrival and last departure for older records. */
export function recordPunches(r: Pick<AttendanceRecord, 'clock_in' | 'clock_out' | 'punches'>): Punch[] {
  if (r.punches?.length) return r.punches;
  return r.clock_in ? [{ in: r.clock_in, out: r.clock_out }] : [];
}

/** True while the day's last pair has no clock-out. */
export const hasOpenPunch = (r: Pick<AttendanceRecord, 'clock_in' | 'clock_out' | 'punches'>) => {
  const p = recordPunches(r);
  return p.length > 0 && p[p.length - 1]!.out === null;
};

/** Paid minutes of a scheduled day (the break is unpaid). */
export function paidMinutes(p: WorkPattern): number {
  const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  const brk = p.breakStart && p.breakEnd ? m(p.breakEnd) - m(p.breakStart) : 0;
  return m(p.end) - m(p.start) - brk;
}

/** "09:00–21:00" or "09:00–21:00, break 13:00–17:00". */
export function shiftText(t: T, p: Pick<WorkPattern, 'start' | 'end' | 'breakStart' | 'breakEnd'>): string {
  const hours = `${p.start}–${p.end}`;
  // Isolated left-to-right so the times keep their order inside Arabic text (the break text isolates its own).
  return p.breakStart && p.breakEnd ? t('hr.shiftWithBreak', { hours, break: `${p.breakStart}–${p.breakEnd}` }) : `\u2066${hours}\u2069`;
}

/** "1 h 25 min" style duration. */
export function duration(t: T, minutes: number | string | null | undefined): string {
  const m = Math.round(num(minutes));
  if (m < 60) return t('hr.mins', { n: m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('hr.hm', { h, m: r }) : t('hr.hours', { h });
}

/** "1 day", "2 days", "3 days", "11 days" with the Arabic singular, dual and plural forms; halves use the plain form. */
export function daysCount(t: T, value: number | string): string {
  const n = Math.round(num(value) * 100) / 100;
  if (n === 1) return t('pay.qty.day1');
  if (n === 2) return t('pay.qty.day2');
  if (Number.isInteger(n) && n >= 3 && n <= 10) return t('pay.qty.daysFew', { n });
  return t('pay.qty.days', { n });
}

/** Minutes as a count ("125 min"), not split into hours, matching how payroll counted them. */
export function minutesCount(t: T, value: number | string): string {
  const n = Math.round(num(value));
  return n >= 3 && n <= 10 ? t('pay.qty.minutesFew', { n }) : t('pay.qty.minutes', { n });
}

/**
 * A payslip line's quantity in the reader's language ("3 أيام", "125 دقيقة", "15 من 30 يومًا", "11٪"). Lines from
 * before Sprint 21 carry only the English `basis`, which is parsed the same way; anything else is a free-text note
 * and is returned as `note`.
 */
export function lineQuantity(t: T, l: Pick<PayslipLine, 'basis' | 'quantity'>): { text: string | null; note: string | null } {
  const q = l.quantity ?? basisQuantity(l.basis);
  if (!q) return { text: null, note: l.basis?.trim() || null };
  const v = Math.round(num(q.value) * 100) / 100;
  if (q.unit === 'minutes') return { text: minutesCount(t, v), note: null };
  if (q.unit === 'days') return { text: daysCount(t, v), note: null };
  if (q.unit === 'hours') return { text: t('pay.qty.hours', { n: v }), note: null };
  if (q.unit === 'percent') return { text: t('pay.qty.percent', { n: v }), note: null };
  return { text: t('pay.qty.daysOf', { n: v, of: num(q.of) }), note: null };
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

/** A typed network becomes a CIDR range: a bare IPv4 address is one address (/32), a bare IPv6 address /128. */
export function normaliseNetwork(v: string): string {
  const x = v.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!x || x.includes('/')) return x;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(x)) return `${x}/32`;
  if (x.includes(':')) return `${x}/128`;
  return x;
}
