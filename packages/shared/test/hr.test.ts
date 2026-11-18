import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_PATTERN,
  HR_DEFAULTS,
  annualIncomeTax,
  annualLeaveEntitlement,
  computeAttendance,
  computePayslip,
  hrSettings,
  scheduledShift,
  workingDaysBetween,
  type PayslipInput,
} from '../src/hr';

const EGP = 100;

describe('attendance', () => {
  const shift = { start: 9 * 60, end: 17 * 60 };
  it('ignores lateness within the grace period', () => {
    expect(computeAttendance({ shift, clockIn: 9 * 60 + 10, clockOut: 17 * 60, graceMinutes: 15, permissions: [] })).toMatchObject({ lateMinutes: 0, workedMinutes: 470, overtimeMinutes: 0 });
  });
  it('excuses lateness covered by an approved permission and counts overtime', () => {
    const r = computeAttendance({ shift, clockIn: 9 * 60 + 40, clockOut: 18 * 60, graceMinutes: 15, permissions: [{ start: 9 * 60, end: 9 * 60 + 30 }] });
    expect(r).toMatchObject({ lateMinutes: 10, earlyLeaveMinutes: 0, overtimeMinutes: 60 });
  });
  it('counts unexcused early leaving', () => {
    const r = computeAttendance({ shift, clockIn: 9 * 60, clockOut: 16 * 60, graceMinutes: 15, permissions: [{ start: 16 * 60 + 30, end: 17 * 60 }] });
    expect(r.earlyLeaveMinutes).toBe(30);
  });
  it('treats work on a rest day as overtime', () => {
    expect(computeAttendance({ shift: null, clockIn: 10 * 60, clockOut: 14 * 60, graceMinutes: 15, permissions: [] })).toMatchObject({ restDay: true, overtimeMinutes: 240 });
  });
  it('schedules Saturday to Wednesday by default and skips public holidays', () => {
    // 2026-11-21 is a Saturday, 2026-11-27 a Friday.
    expect(scheduledShift(DEFAULT_WORK_PATTERN, '2026-11-21')).toEqual({ start: 540, end: 1020 });
    expect(scheduledShift(DEFAULT_WORK_PATTERN, '2026-11-27')).toBeNull();
    expect(workingDaysBetween(DEFAULT_WORK_PATTERN, '2026-11-21', '2026-11-27')).toBe(5);
    expect(workingDaysBetween(DEFAULT_WORK_PATTERN, '2026-11-21', '2026-11-27', new Set(['2026-11-23']))).toBe(4);
  });
});

describe('leave entitlement', () => {
  it('follows service length and age', () => {
    expect(annualLeaveEntitlement('2026-08-01', 2026)).toBe(0); // under six months by year end
    expect(annualLeaveEntitlement('2026-03-01', 2026)).toBe(12.5); // first year: 15 days prorated for 10 months
    expect(annualLeaveEntitlement('2025-07-01', 2026)).toBe(21);
    expect(annualLeaveEntitlement('2015-01-01', 2026)).toBe(30);
    expect(annualLeaveEntitlement('2024-01-01', 2026, '1975-05-05')).toBe(30);
  });
});

describe('payroll', () => {
  it('applies the progressive brackets after the personal exemption', () => {
    // 139,020 EGP a year: 119,020 after exemption → 0 + 1,500 + 2,250 + 9,804 = 13,554 EGP.
    expect(annualIncomeTax(139020 * EGP, HR_DEFAULTS.incomeTax)).toBe(13554 * EGP);
    expect(annualIncomeTax(50000 * EGP, HR_DEFAULTS.incomeTax)).toBe(0);
  });

  const base: PayslipInput = {
    payBasis: 'monthly',
    baseSalary: 12000 * EGP,
    allowances: [{ code: 'transport', nameAr: 'بدل انتقال', nameEn: 'Transport', amount: 1000 * EGP, taxable: true }],
    insurableWage: 10000 * EGP,
    dayMinutes: 480,
    periodDays: 30,
    employedDays: 30,
    workedMinutes: 0,
    absentDays: 1,
    unpaidLeaveDays: 0,
    latenessMinutes: 60,
    overtimeMinutes: 120,
    restDayOvertimeMinutes: 0,
    commission: 0,
    adjustments: [],
  };

  it('computes a worked example end to end', () => {
    const r = computePayslip(base, hrSettings());
    // Daily 400, hourly 50. Earnings 12,000 + 1,000 + overtime 2h × 50 × 1.35 = 135; less absence 400 and lateness 50.
    expect(r.gross).toBe(1268500);
    expect(r.employeeInsurance).toBe(110000); // 11% of 10,000
    expect(r.employerInsurance).toBe(187500); // 18.75% of 10,000
    expect(r.taxable).toBe(1158500);
    expect(r.incomeTax).toBe(112950); // 13,554 EGP a year / 12
    expect(r.martyrsFund).toBe(634); // 0.05% of gross
    expect(r.net).toBe(1268500 - 110000 - 112950 - 634);
    expect(r.employerCost).toBe(1268500 + 187500);
    expect(r.lines.find((l) => l.code === 'absence')?.amount).toBe(40000);
    expect(r.warnings).toEqual([]);
  });

  it('caps the insurable wage, prorates joiners and handles commission-only doctors', () => {
    const capped = computePayslip({ ...base, insurableWage: 30000 * EGP, absentDays: 0, latenessMinutes: 0, overtimeMinutes: 0 }, hrSettings());
    expect(capped.employeeInsurance).toBe(Math.round(14500 * EGP * 0.11));
    expect(capped.warnings).toContain('insurable_wage_capped');

    const joiner = computePayslip({ ...base, employedDays: 15, absentDays: 0, latenessMinutes: 0, overtimeMinutes: 0, insurableWage: null }, hrSettings());
    expect(joiner.lines.find((l) => l.code === 'base')?.amount).toBe(600000);

    const doctor = computePayslip({ ...base, payBasis: 'commission_only', baseSalary: 0, allowances: [], insurableWage: null, absentDays: 0, latenessMinutes: 0, overtimeMinutes: 0, commission: 25000 * EGP }, hrSettings());
    expect(doctor.gross).toBe(2500000);
    expect(doctor.lines.some((l) => l.code === 'absence')).toBe(false);
  });

  it('keeps reimbursements and advances out of tax and deducts repayments after tax', () => {
    const r = computePayslip(
      {
        ...base, absentDays: 0, latenessMinutes: 0, overtimeMinutes: 0,
        adjustments: [
          { kind: 'reimbursement', amount: 500 * EGP, taxable: false },
          { kind: 'advance_repayment', amount: 1000 * EGP, taxable: false },
        ],
      },
      hrSettings(),
    );
    const plain = computePayslip({ ...base, absentDays: 0, latenessMinutes: 0, overtimeMinutes: 0 }, hrSettings());
    expect(r.taxable).toBe(plain.taxable);
    expect(r.net).toBe(plain.net + 500 * EGP - 1000 * EGP);
  });

  it('merges organisation overrides with the defaults', () => {
    const s = hrSettings({ graceMinutes: 5, socialInsurance: { ...HR_DEFAULTS.socialInsurance, year: 2026 } });
    expect(s.graceMinutes).toBe(5);
    expect(s.socialInsurance.employeeRate).toBe(0.11);
    expect(s.socialInsurance.year).toBe(2026);
  });
});

describe('clock-in location and settings overrides', () => {
  it('measures distance and credits limited GPS accuracy', async () => {
    const { haversineMeters, insideGeofence } = await import('../src/hr');
    const clinic = { lat: 30.0566, lng: 31.3301 }; // Nasr City
    expect(Math.round(haversineMeters(clinic, { lat: 30.0566, lng: 31.3311 }))).toBe(96);
    expect(insideGeofence(clinic, { lat: 30.0566, lng: 31.3311, accuracy: 10 }, 100).inside).toBe(true);
    expect(insideGeofence(clinic, { lat: 30.0566, lng: 31.3331, accuracy: 20 }, 100)).toMatchObject({ inside: false, distance: 289 });
    // A 2 km "accuracy" cannot pull a far position inside: only 100 m is credited.
    expect(insideGeofence(clinic, { lat: 30.0566, lng: 31.3331, accuracy: 2000 }, 100).inside).toBe(false);
  });
  it('stores only settings that differ from the defaults', async () => {
    const { hrOverrides } = await import('../src/hr');
    expect(hrOverrides(hrSettings())).toEqual({});
    const o = hrOverrides(hrSettings({ graceMinutes: 10, socialInsurance: { ...HR_DEFAULTS.socialInsurance, year: 2026 } }));
    expect(Object.keys(o).sort()).toEqual(['graceMinutes', 'socialInsurance']);
  });
});

describe('night overtime, leave payout and structured quantities', () => {
  it('splits overtime inside the night window and pays it at the night rate', async () => {
    const { computeAttendance, nightOverlap, computePayslip } = await import('../src/hr');
    const night = { start: 19 * 60, end: 7 * 60 };
    expect(nightOverlap(17 * 60, 21 * 60, night)).toBe(120); // 19:00–21:00
    expect(nightOverlap(22 * 60, 26 * 60, night)).toBe(240); // across midnight
    expect(nightOverlap(6 * 60, 8 * 60, night)).toBe(60); // early morning
    const a = computeAttendance({ shift: { start: 9 * 60, end: 17 * 60 }, clockIn: 9 * 60, clockOut: 20 * 60, graceMinutes: 15, permissions: [], night });
    expect(a).toMatchObject({ overtimeMinutes: 180, overtimeNightMinutes: 60 });
    const p = computePayslip({ payBasis: 'monthly', baseSalary: 1200000, allowances: [], insurableWage: null, dayMinutes: 480, periodDays: 30, employedDays: 30, workedMinutes: 0, absentDays: 0, unpaidLeaveDays: 0, latenessMinutes: 0, overtimeMinutes: 180, nightOvertimeMinutes: 60, restDayOvertimeMinutes: 0, commission: 0, adjustments: [] }, hrSettings());
    // Hourly 50 EGP: 2 h × 1.35 = 135 EGP day overtime; 1 h × 1.7 = 85 EGP night overtime.
    expect(p.lines.find((l) => l.code === 'overtime')).toMatchObject({ amount: 13500, quantity: { value: 120, unit: 'minutes' } });
    expect(p.lines.find((l) => l.code === 'overtime_night')?.amount).toBe(8500);
  });
  it('prorates a leaver\'s entitlement and describes quantities as data', async () => {
    const { leaverEntitlement, basisQuantity } = await import('../src/hr');
    expect(leaverEntitlement(21, '2020-01-01', '2026-06-30', 2026)).toBe(10); // 181/365 × 21 = 10.4 → 10
    expect(leaverEntitlement(21, '2026-03-01', '2026-06-30', 2026)).toBe(7); // 122/365 × 21 = 7.0
    expect(basisQuantity('3 d')).toEqual({ value: 3, unit: 'days' });
    expect(basisQuantity('15/30')).toEqual({ value: 15, unit: 'days_of', of: 30 });
    expect(basisQuantity('11%')).toEqual({ value: 11, unit: 'percent' });
    expect(basisQuantity('Excellent feedback')).toBeUndefined();
  });
});

describe('split shifts and several clock-in pairs', () => {
  it('handles a break, a late return and stepping out', async () => {
    const { computeAttendance, shiftMinutes, workPatternSchema } = await import('../src/hr');
    const pattern = workPatternSchema.parse({ days: [6], start: '09:00', end: '21:00', breakStart: '13:00', breakEnd: '17:00' });
    expect(shiftMinutes(pattern)).toBe(480);
    const shift = { start: 540, end: 1260, breakStart: 780, breakEnd: 1020 };
    // On time, out for the break, back 20 minutes late, leaves 10 minutes early.
    const a = computeAttendance({ shift, clockIn: null, clockOut: null, punches: [{ in: 540, out: 780 }, { in: 1040, out: 1250 }], graceMinutes: 15, permissions: [] });
    expect(a).toMatchObject({ workedMinutes: 450, lateMinutes: 20, earlyLeaveMinutes: 10, overtimeMinutes: 0 });
    // Stepping out 10:00–10:30 without a permission counts as missed time; with one it is excused.
    const out = [{ in: 540, out: 600 }, { in: 630, out: 780 }, { in: 1020, out: 1260 }];
    expect(computeAttendance({ shift, clockIn: null, clockOut: null, punches: out, graceMinutes: 15, permissions: [] }).lateMinutes).toBe(30);
    expect(computeAttendance({ shift, clockIn: null, clockOut: null, punches: out, graceMinutes: 15, permissions: [{ start: 600, end: 630 }] }).lateMinutes).toBe(0);
    // Working through the break is not overtime; staying past the end is.
    expect(computeAttendance({ shift, clockIn: 540, clockOut: 1290, graceMinutes: 15, permissions: [] })).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 30 });
    // Still clocked in: nothing counts as early leaving yet.
    expect(computeAttendance({ shift, clockIn: null, clockOut: null, punches: [{ in: 540, out: 780 }, { in: 1020, out: null }], graceMinutes: 15, permissions: [] }).earlyLeaveMinutes).toBe(0);
    expect(() => workPatternSchema.parse({ days: [6], start: '09:00', end: '21:00', breakStart: '08:00', breakEnd: '10:00' })).toThrow();
  });
});
