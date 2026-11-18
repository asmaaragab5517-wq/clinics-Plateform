import { z } from 'zod';
import { addDays, minutesOf, weekdayOf } from './datetime';
import { divRoundHalfUp, type Piastres } from './money';

/**
 * Staff HR and payroll rules (Sprint 19).
 *
 * Defaults follow Egyptian practice as we understand it: Labour Law 14/2025 for leave and overtime, Social Insurance
 * Law 148/2019 for contributions, Income Tax Law 91/2005 as amended by Law 7/2024 for brackets, and the Martyrs'
 * Fund deduction. Every figure is an organisation setting because the authorities revise them (social-insurance
 * wage limits change each January). Have the organisation's accountant confirm them before the first payroll.
 */

// ---- Settings ----------------------------------------------------------------------------------------------------

export const taxBracketSchema = z.object({ upTo: z.number().int().positive().nullable(), rate: z.number().min(0).max(1) });

export const hrSettingsSchema = z.object({
  /** Minutes after the scheduled start before lateness counts. */
  graceMinutes: z.number().int().min(0).max(120),
  /** Approved hourly permissions allowed per person per month (count and total minutes). */
  permissionsPerMonth: z.number().int().min(0).max(31),
  permissionMinutesPerMonth: z.number().int().min(0).max(6000),
  /** Deduct unexcused lateness and early leaving from pay at the hourly rate. */
  deductLateness: z.boolean(),
  /** Overtime pay multipliers on the hourly rate. */
  overtimeMultiplier: z.number().min(1).max(5),
  restDayMultiplier: z.number().min(1).max(5),
  /** Days used to derive the daily rate from a monthly salary (Egyptian practice: 30). */
  daysPerMonth: z.number().int().min(20).max(31),
  socialInsurance: z.object({
    /** Year these limits apply to; payroll warns when a period is in a later year. */
    year: z.number().int().min(2020).max(2100),
    employeeRate: z.number().min(0).max(1),
    employerRate: z.number().min(0).max(1),
    minWage: z.number().int().min(0),
    maxWage: z.number().int().min(0),
  }),
  incomeTax: z.object({
    /** Annual personal exemption (piastres). */
    personalExemption: z.number().int().min(0),
    /** Annual brackets on taxable income after the exemption (piastres), ascending; last has upTo null. */
    brackets: z.array(taxBracketSchema).min(1),
  }),
  /** Martyrs' Fund contribution as a fraction of gross pay. */
  martyrsFundRate: z.number().min(0).max(0.01),
});
export type HrSettings = z.infer<typeof hrSettingsSchema>;

const egp = (n: number) => n * 100;

export const HR_DEFAULTS: HrSettings = {
  graceMinutes: 15,
  permissionsPerMonth: 2,
  permissionMinutesPerMonth: 240,
  deductLateness: true,
  overtimeMultiplier: 1.35,
  restDayMultiplier: 2,
  daysPerMonth: 30,
  socialInsurance: { year: 2025, employeeRate: 0.11, employerRate: 0.1875, minWage: egp(2300), maxWage: egp(14500) },
  incomeTax: {
    personalExemption: egp(20000),
    brackets: [
      { upTo: egp(40000), rate: 0 },
      { upTo: egp(55000), rate: 0.1 },
      { upTo: egp(70000), rate: 0.15 },
      { upTo: egp(200000), rate: 0.2 },
      { upTo: egp(400000), rate: 0.225 },
      { upTo: egp(1200000), rate: 0.25 },
      { upTo: null, rate: 0.275 },
    ],
  },
  martyrsFundRate: 0.0005,
};

/** Organisation overrides on top of the defaults (deep for the two nested groups). */
export function hrSettings(overrides?: Partial<HrSettings> | null): HrSettings {
  const o = overrides ?? {};
  return {
    ...HR_DEFAULTS,
    ...o,
    socialInsurance: { ...HR_DEFAULTS.socialInsurance, ...(o.socialInsurance ?? {}) },
    incomeTax: { ...HR_DEFAULTS.incomeTax, ...(o.incomeTax ?? {}) },
  };
}

// ---- Work patterns and attendance -----------------------------------------------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Weekly working pattern: weekdays 0 = Sunday … 6 = Saturday (Egyptian week starts Saturday). */
export const workPatternSchema = z
  .object({ days: z.array(z.number().int().min(0).max(6)).max(7), start: hhmm, end: hhmm })
  .refine((p) => minutesOf(p.end) > minutesOf(p.start), { message: 'end must be after start', path: ['end'] });
export type WorkPattern = z.infer<typeof workPatternSchema>;

export const DEFAULT_WORK_PATTERN: WorkPattern = { days: [6, 0, 1, 2, 3], start: '09:00', end: '17:00' };

export const PERMISSION_KINDS = ['late_arrival', 'early_leave', 'during_day'] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

/** Scheduled shift for a date, or null on a rest day or public holiday. */
export function scheduledShift(pattern: WorkPattern, date: string, holidays: ReadonlySet<string> = new Set()): { start: number; end: number } | null {
  if (holidays.has(date) || !pattern.days.includes(weekdayOf(date))) return null;
  return { start: minutesOf(pattern.start), end: minutesOf(pattern.end) };
}

export function shiftMinutes(pattern: WorkPattern): number {
  return minutesOf(pattern.end) - minutesOf(pattern.start);
}

export interface AttendanceInput {
  /** Scheduled shift in local minutes after midnight, or null on a rest day/holiday. */
  shift: { start: number; end: number } | null;
  /** Local clock-in/out minutes after midnight (clock-out may exceed 1440 for a shift past midnight). */
  clockIn: number | null;
  clockOut: number | null;
  graceMinutes: number;
  /** Approved permissions for the day as local minute ranges. */
  permissions: { start: number; end: number }[];
}

export interface AttendanceResult {
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  restDay: boolean;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Lateness, early leaving and overtime for one day. Lateness within the grace period is ignored; time covered by an
 * approved permission is excused. Work on a rest day is all overtime (paid at the rest-day multiplier).
 */
export function computeAttendance(i: AttendanceInput): AttendanceResult {
  if (i.clockIn === null) return { workedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, restDay: i.shift === null };
  const out = i.clockOut ?? i.clockIn;
  const worked = Math.max(0, out - i.clockIn);
  if (!i.shift) return { workedMinutes: worked, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: i.clockOut === null ? 0 : worked, restDay: true };
  const excused = (from: number, to: number) => i.permissions.reduce((a, p) => a + overlap(from, to, p.start, p.end), 0);
  const lateRaw = Math.max(0, i.clockIn - i.shift.start);
  const late = lateRaw <= i.graceMinutes ? 0 : Math.max(0, lateRaw - excused(i.shift.start, i.clockIn));
  const earlyRaw = i.clockOut === null ? 0 : Math.max(0, i.shift.end - out);
  const early = Math.max(0, earlyRaw - excused(out, i.shift.end));
  const overtime = i.clockOut === null ? 0 : Math.max(0, out - i.shift.end);
  return { workedMinutes: worked, lateMinutes: late, earlyLeaveMinutes: early, overtimeMinutes: overtime, restDay: false };
}

/** Working days in [from, to] under a pattern, excluding public holidays. */
export function workingDaysBetween(pattern: WorkPattern, from: string, to: string, holidays: ReadonlySet<string> = new Set()): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (scheduledShift(pattern, d, holidays)) n++;
  return n;
}

// ---- Leave ------------------------------------------------------------------------------------------------------

export const LEAVE_KINDS = ['annual', 'casual', 'sick', 'unpaid', 'maternity', 'hajj', 'exam', 'bereavement', 'other'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

/** Default leave types seeded per organisation (Labour Law 14/2025 as we understand it; confirm with counsel). */
export const DEFAULT_LEAVE_TYPES: { code: LeaveKind; nameAr: string; nameEn: string; paid: boolean; usesAnnualBalance: boolean; annualQuota: number | null; maxConsecutiveDays: number | null }[] = [
  { code: 'annual', nameAr: 'إجازة اعتيادية', nameEn: 'Annual leave', paid: true, usesAnnualBalance: true, annualQuota: null, maxConsecutiveDays: null },
  { code: 'casual', nameAr: 'إجازة عارضة', nameEn: 'Casual leave', paid: true, usesAnnualBalance: true, annualQuota: 7, maxConsecutiveDays: 2 },
  { code: 'sick', nameAr: 'إجازة مرضية', nameEn: 'Sick leave', paid: true, usesAnnualBalance: false, annualQuota: null, maxConsecutiveDays: null },
  { code: 'unpaid', nameAr: 'إجازة بدون أجر', nameEn: 'Unpaid leave', paid: false, usesAnnualBalance: false, annualQuota: null, maxConsecutiveDays: null },
  { code: 'maternity', nameAr: 'إجازة وضع', nameEn: 'Maternity leave', paid: true, usesAnnualBalance: false, annualQuota: 120, maxConsecutiveDays: 120 },
  { code: 'hajj', nameAr: 'إجازة حج', nameEn: 'Hajj leave', paid: true, usesAnnualBalance: false, annualQuota: 30, maxConsecutiveDays: 30 },
  { code: 'exam', nameAr: 'إجازة امتحانات', nameEn: 'Exam leave', paid: true, usesAnnualBalance: false, annualQuota: null, maxConsecutiveDays: null },
  { code: 'bereavement', nameAr: 'إجازة وفاة', nameEn: 'Bereavement leave', paid: true, usesAnnualBalance: false, annualQuota: 3, maxConsecutiveDays: 3 },
];

/**
 * Annual leave days for a calendar year: 15 in the first year once six months are served, 21 from the first full
 * year, 30 from ten years of service or age fifty. Prorated by months served in the joining year.
 */
export function annualLeaveEntitlement(startDate: string, year: number, dateOfBirth?: string | null): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  if (start > yearEnd) return 0;
  const monthsByYearEnd = (yearEnd.getUTCFullYear() - start.getUTCFullYear()) * 12 + (yearEnd.getUTCMonth() - start.getUTCMonth());
  const ageAtYearEnd = dateOfBirth ? year - Number(dateOfBirth.slice(0, 4)) : 0;
  if (monthsByYearEnd >= 120 || ageAtYearEnd >= 50) return 30;
  if (monthsByYearEnd >= 12) {
    // The year in which the first anniversary falls: 21 days from then on.
    return 21;
  }
  if (monthsByYearEnd < 6) return 0;
  // First year: 15 days, prorated for the months of this calendar year served.
  const monthsThisYear = start.getUTCFullYear() === year ? 12 - start.getUTCMonth() : 12;
  return Math.round((15 * monthsThisYear) / 12 * 2) / 2;
}

// ---- Payroll ----------------------------------------------------------------------------------------------------

export const ALLOWANCE_SCHEMA = z.object({ code: z.string().min(1).max(30), nameAr: z.string().min(1), nameEn: z.string().default(''), amount: z.number().int().min(0), taxable: z.boolean().default(true) });
export type Allowance = z.infer<typeof ALLOWANCE_SCHEMA>;

export const ADJUSTMENT_KINDS = ['bonus', 'allowance', 'overtime', 'reimbursement', 'deduction', 'advance', 'advance_repayment'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export interface PayslipInput {
  payBasis: 'monthly' | 'hourly' | 'commission_only';
  /** Monthly salary, or hourly rate for hourly staff (piastres). */
  baseSalary: Piastres;
  allowances: Allowance[];
  /** Monthly wage declared for social insurance; null when the person is not insured through the clinic. */
  insurableWage: Piastres | null;
  /** Standard minutes in one working day (from the work pattern). */
  dayMinutes: number;
  /** Calendar days in the period and days the person was employed in it (joiners/leavers are prorated). */
  periodDays: number;
  employedDays: number;
  workedMinutes: number;
  absentDays: number;
  unpaidLeaveDays: number;
  latenessMinutes: number;
  overtimeMinutes: number;
  restDayOvertimeMinutes: number;
  commission: Piastres;
  adjustments: { kind: AdjustmentKind; amount: Piastres; taxable: boolean; note?: string | null }[];
}

export interface PayslipLine {
  code: string;
  labelAr: string;
  labelEn: string;
  /** Positive amounts; `kind` says whether the line adds to or reduces pay. */
  amount: Piastres;
  kind: 'earning' | 'deduction' | 'employer';
  /** Quantity basis shown on the payslip, e.g. "3 days" or "125 min". */
  basis?: string;
}

export interface PayslipResult {
  lines: PayslipLine[];
  gross: Piastres;
  taxable: Piastres;
  employeeInsurance: Piastres;
  employerInsurance: Piastres;
  incomeTax: Piastres;
  martyrsFund: Piastres;
  deductions: Piastres;
  net: Piastres;
  employerCost: Piastres;
  warnings: string[];
}

const mul = (amount: number, factor: number) => Math.round(amount * factor);

/** Annual income tax on annual taxable income (piastres) under progressive brackets after the personal exemption. */
export function annualIncomeTax(annualTaxable: Piastres, s: HrSettings['incomeTax']): Piastres {
  let remaining = Math.max(0, annualTaxable - s.personalExemption);
  let floor = 0;
  let tax = 0;
  for (const b of s.brackets) {
    const width = b.upTo === null ? Infinity : b.upTo - floor;
    const portion = Math.min(remaining, width);
    if (portion <= 0) break;
    tax += portion * b.rate;
    remaining -= portion;
    if (b.upTo !== null) floor = b.upTo;
  }
  return Math.round(tax);
}

/** Monthly payslip from contract, attendance and adjustments. Amounts are integer piastres. */
export function computePayslip(i: PayslipInput, s: HrSettings): PayslipResult {
  const lines: PayslipLine[] = [];
  const warnings: string[] = [];
  const earn = (code: string, labelAr: string, labelEn: string, amount: number, basis?: string) => {
    if (amount > 0) lines.push({ code, labelAr, labelEn, amount, kind: 'earning', basis });
  };
  const deduct = (code: string, labelAr: string, labelEn: string, amount: number, basis?: string) => {
    if (amount > 0) lines.push({ code, labelAr, labelEn, amount, kind: 'deduction', basis });
  };

  const monthly = i.payBasis === 'monthly' ? i.baseSalary : 0;
  const dailyRate = i.payBasis === 'monthly' ? monthly / s.daysPerMonth : 0;
  const hourlyRate = i.payBasis === 'hourly' ? i.baseSalary : i.dayMinutes > 0 ? (dailyRate * 60) / i.dayMinutes : 0;
  const prorate = i.employedDays >= i.periodDays ? 1 : i.employedDays / i.periodDays;

  // Earnings
  if (i.payBasis === 'monthly') earn('base', 'الأجر الأساسي', 'Basic salary', Math.round(monthly * prorate), prorate < 1 ? `${i.employedDays}/${i.periodDays}` : undefined);
  if (i.payBasis === 'hourly') earn('base', 'أجر الساعات', 'Hours worked', Math.round((hourlyRate * i.workedMinutes) / 60), `${Math.round(i.workedMinutes / 6) / 10} h`);
  for (const a of i.allowances) earn(`allowance:${a.code}`, a.nameAr, a.nameEn || a.nameAr, Math.round(a.amount * prorate));
  earn('overtime', 'أجر إضافي', 'Overtime', Math.round((hourlyRate * i.overtimeMinutes * s.overtimeMultiplier) / 60), `${i.overtimeMinutes} min`);
  earn('overtime_rest', 'عمل في يوم الراحة', 'Rest-day work', Math.round((hourlyRate * i.restDayOvertimeMinutes * s.restDayMultiplier) / 60), `${i.restDayOvertimeMinutes} min`);
  earn('commission', 'عمولة الطبيب', 'Doctor commission', i.commission);
  for (const a of i.adjustments) {
    if (a.kind === 'bonus') earn('bonus', 'مكافأة', 'Bonus', a.amount, a.note ?? undefined);
    if (a.kind === 'allowance') earn('allowance:extra', 'بدل إضافي', 'Additional allowance', a.amount, a.note ?? undefined);
    if (a.kind === 'overtime') earn('overtime_manual', 'أجر إضافي (يدوي)', 'Overtime (manual)', a.amount, a.note ?? undefined);
  }

  // Pay-reducing items (before tax)
  if (i.payBasis === 'monthly') {
    deduct('absence', 'خصم غياب', 'Absence', Math.round(dailyRate * i.absentDays), `${i.absentDays} d`);
    deduct('unpaid_leave', 'إجازة بدون أجر', 'Unpaid leave', Math.round(dailyRate * i.unpaidLeaveDays), `${i.unpaidLeaveDays} d`);
    if (s.deductLateness) deduct('lateness', 'خصم تأخير وانصراف مبكر', 'Lateness and early leaving', Math.round((hourlyRate * i.latenessMinutes) / 60), `${i.latenessMinutes} min`);
  }
  for (const a of i.adjustments) if (a.kind === 'deduction' && a.taxable) deduct('deduction', 'خصم', 'Deduction', a.amount, a.note ?? undefined);

  const sum = (k: PayslipLine['kind'], pred: (l: PayslipLine) => boolean = () => true) => lines.filter((l) => l.kind === k && pred(l)).reduce((a, l) => a + l.amount, 0);
  const taxFree = new Set(i.allowances.filter((a) => !a.taxable).map((a) => `allowance:${a.code}`));
  const grossEarnings = sum('earning');
  const preTaxDeductions = sum('deduction');
  const gross = Math.max(0, grossEarnings - preTaxDeductions);
  const nonTaxableEarnings = sum('earning', (l) => taxFree.has(l.code));

  // Social insurance on the declared wage, within the year's limits.
  let employeeInsurance = 0;
  let employerInsurance = 0;
  if (i.insurableWage !== null && i.insurableWage > 0) {
    const si = s.socialInsurance;
    const wage = Math.min(Math.max(i.insurableWage, si.minWage), si.maxWage);
    if (i.insurableWage < si.minWage) warnings.push('insurable_wage_below_minimum');
    if (i.insurableWage > si.maxWage) warnings.push('insurable_wage_capped');
    employeeInsurance = mul(wage * prorate, si.employeeRate);
    employerInsurance = mul(wage * prorate, si.employerRate);
    deduct('social_insurance', 'حصة العامل في التأمينات', 'Social insurance (employee)', employeeInsurance, `${si.employeeRate * 100}%`);
    lines.push({ code: 'social_insurance_employer', labelAr: 'حصة صاحب العمل في التأمينات', labelEn: 'Social insurance (employer)', amount: employerInsurance, kind: 'employer', basis: `${si.employerRate * 100}%` });
  }

  // Income tax: annualise the month's taxable pay, apply brackets, divide back.
  const taxable = Math.max(0, gross - nonTaxableEarnings - employeeInsurance);
  const annualTaxable = taxable * 12;
  if (annualTaxable > egp(600000)) warnings.push('high_income_tax_review');
  const incomeTax = Math.round(annualIncomeTax(annualTaxable, s.incomeTax) / 12);
  deduct('income_tax', 'ضريبة كسب العمل', 'Income tax', incomeTax);

  const martyrsFund = mul(gross, s.martyrsFundRate);
  deduct('martyrs_fund', 'صندوق تكريم الشهداء', "Martyrs' Fund", martyrsFund, `${s.martyrsFundRate * 100}%`);

  // After-tax items
  for (const a of i.adjustments) {
    if (a.kind === 'reimbursement') earn('reimbursement', 'استرداد مصروفات', 'Reimbursement', a.amount, a.note ?? undefined);
    if (a.kind === 'advance') earn('advance', 'سلفة', 'Salary advance', a.amount, a.note ?? undefined);
    if (a.kind === 'advance_repayment') deduct('advance_repayment', 'سداد سلفة', 'Advance repayment', a.amount, a.note ?? undefined);
    if (a.kind === 'deduction' && !a.taxable) deduct('deduction_post_tax', 'خصم', 'Deduction', a.amount, a.note ?? undefined);
  }
  const postTaxEarnings = sum('earning', (l) => l.code === 'reimbursement' || l.code === 'advance');
  const deductions = sum('deduction') - preTaxDeductions;
  const net = gross + postTaxEarnings - deductions;
  if (net < 0) warnings.push('negative_net_pay');
  return {
    lines,
    gross,
    taxable,
    employeeInsurance,
    employerInsurance,
    incomeTax,
    martyrsFund,
    deductions,
    net,
    employerCost: gross + postTaxEarnings + employerInsurance,
    warnings,
  };
}

// ---- Request schemas ----------------------------------------------------------------------------------------------

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const leaveRequestSchema = z
  .object({ leaveTypeId: z.string().uuid(), startDate: zDay, endDate: zDay, reason: z.string().max(1000).optional(), userId: z.string().uuid().optional() })
  .refine((r) => r.endDate >= r.startDate, { message: 'end before start', path: ['endDate'] });

export const permissionRequestSchema = z
  .object({ workDate: zDay, kind: z.enum(PERMISSION_KINDS), startTime: hhmm, endTime: hhmm, reason: z.string().max(1000).optional(), userId: z.string().uuid().optional() })
  .refine((r) => minutesOf(r.endTime) > minutesOf(r.startTime), { message: 'end before start', path: ['endTime'] });

export const contractSchema = z.object({
  clinicId: z.string().uuid(),
  jobTitleAr: z.string().min(2).max(120),
  jobTitleEn: z.string().max(120).default(''),
  employmentType: z.enum(['full_time', 'part_time', 'contractor']),
  payBasis: z.enum(['monthly', 'hourly', 'commission_only']),
  startDate: zDay,
  endDate: zDay.nullable().optional(),
  baseSalary: z.number().int().min(0),
  allowances: z.array(ALLOWANCE_SCHEMA).max(20).default([]),
  insurableWage: z.number().int().min(0).nullable().optional(),
  socialInsuranceNumber: z.string().max(30).nullable().optional(),
  bankName: z.string().max(80).nullable().optional(),
  iban: z.string().regex(/^EG\d{27}$/, 'Egyptian IBAN: EG + 27 digits').nullable().optional(),
  workPattern: workPatternSchema,
  dateOfBirth: zDay.nullable().optional(),
});
export type ContractInput = z.infer<typeof contractSchema>;
