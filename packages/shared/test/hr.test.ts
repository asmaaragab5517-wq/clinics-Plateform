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
