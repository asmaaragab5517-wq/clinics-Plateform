import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { auth, startHarness, type Harness } from './harness';
import { HrService } from '../src/modules/hr.service';
import { Tenancy } from '../src/common/services';

let h: Harness;
let admin: Client;
const id: Record<string, string> = {};
const EGP = 100;
const pattern = { days: [6, 0, 1, 2, 3], start: '09:00', end: '17:00' }; // Saturday to Wednesday

beforeAll(async () => {
  h = await startHarness('hf_test_api_hr');
  admin = new Client({ connectionString: h.env.adminUrl });
  await admin.connect();
  for (const k of ['owner', 'director', 'manager', 'reception', 'nurse', 'accountant', 'dr_ahmed']) {
    const me = await h.http().get('/v1/auth/me').set(auth(h.staff[k]!));
    id[k] = me.body.userId;
    if (k === 'manager') id.clinic = me.body.memberships.find((m: { clinicId: string | null }) => m.clinicId)?.clinicId ?? h.env.demo.clinicIds[0];
  }
}, 180000);
afterAll(async () => {
  await admin?.end();
  await h?.close();
});

const contract = (over: Record<string, unknown> = {}) => ({
  clinicId: id.clinic, jobTitleAr: 'موظف استقبال', jobTitleEn: 'Receptionist', employmentType: 'full_time', payBasis: 'monthly', startDate: '2026-01-01',
  baseSalary: 9000 * EGP, allowances: [{ code: 'transport', nameAr: 'بدل انتقال', nameEn: 'Transport', amount: 600 * EGP, taxable: true }],
  insurableWage: 6000 * EGP, socialInsuranceNumber: '12345678', bankName: 'Banque Misr', iban: 'EG380019000500000000263180002', workPattern: pattern, ...over,
});

describe('Staff HR and payroll (Sprint 19)', () => {
  it('keeps salary data behind payroll privileges', async () => {
    await h.http().put(`/v1/hr/staff/${id.reception}/contract`).set(auth(h.staff.manager!)).send(contract()).expect(403);
    const saved = await h.http().put(`/v1/hr/staff/${id.reception}/contract`).set(auth(h.staff.accountant!)).send(contract());
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ base_salary: 900000, iban_last4: '0002' });
    expect(saved.body.iban_enc).toBeUndefined();
    await h.http().put(`/v1/hr/staff/${id.nurse}/contract`).set(auth(h.staff.owner!)).send(contract({ jobTitleAr: 'ممرضة', jobTitleEn: 'Nurse', baseSalary: 7000 * EGP, allowances: [], iban: null })).expect(200);
    await h.http().put(`/v1/hr/staff/${id.dr_ahmed}/contract`).set(auth(h.staff.owner!)).send(contract({ jobTitleAr: 'استشاري باطنة', employmentType: 'contractor', payBasis: 'commission_only', baseSalary: 0, allowances: [], insurableWage: null, iban: null })).expect(200);

    const asManager = await h.http().get('/v1/hr/staff').set(auth(h.staff.manager!));
    const rec = asManager.body.find((x: { id: string }) => x.id === id.reception);
    expect(rec.contract.job_title_en).toBe('Receptionist');
    expect(rec.contract.base_salary).toBeUndefined(); // clinic managers do not see pay
    await h.http().get('/v1/payroll/runs').set(auth(h.staff.manager!)).expect(403);
    await h.http().get('/v1/payroll/runs').set(auth(h.staff.reception!)).expect(403);
  });

  it('clocks in and out once a day', async () => {
    const inn = await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.reception!)).send({ action: 'in' });
    expect(inn.status, JSON.stringify(inn.body)).toBe(200);
    expect(inn.body.clock_in).toBeTruthy();
    expect((await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.reception!)).send({ action: 'in' })).body.error).toBe('already_clocked_in');
    const out = await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.reception!)).send({ action: 'out' });
    expect(out.body.status).toBe('complete');
    expect((await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.owner!)).send({ action: 'in' })).body.error).toBe('no_active_contract');
  });

  it('runs leave, permissions, corrections and overtime through approval', async () => {
    await h.http().post('/v1/hr/holidays').set(auth(h.staff.manager!)).send({ date: '2026-10-06', nameAr: 'عيد القوات المسلحة', nameEn: 'Armed Forces Day' }).expect(201);
    const types = (await h.http().get('/v1/hr/leave-types').set(auth(h.staff.reception!))).body as { id: string; code: string }[];
    const type = (code: string) => types.find((t) => t.code === code)!.id;

    // 6 October is a holiday, so 6–7 October is one working day of annual leave.
    const leave = await h.http().post('/v1/hr/leave-requests').set(auth(h.staff.reception!)).send({ leaveTypeId: type('annual'), startDate: '2026-10-06', endDate: '2026-10-07', reason: 'عائلية' });
    expect(leave.status, JSON.stringify(leave.body)).toBe(201);
    expect(Number(leave.body.days)).toBe(1);
    expect((await h.http().post('/v1/hr/leave-requests').set(auth(h.staff.reception!)).send({ leaveTypeId: type('annual'), startDate: '2026-10-07', endDate: '2026-10-07' })).body.error).toBe('overlapping_leave');
    expect((await h.http().post('/v1/hr/leave-requests').set(auth(h.staff.reception!)).send({ leaveTypeId: type('casual'), startDate: '2026-10-17', endDate: '2026-10-19' })).body.error).toBe('exceeds_max_consecutive_days');
    expect((await h.http().post('/v1/hr/leave-requests').set(auth(h.staff.reception!)).send({ leaveTypeId: type('annual'), startDate: '2026-11-01', endDate: '2026-12-31' })).body.error).toBe('insufficient_leave_balance');
    await h.http().post(`/v1/hr/leave-requests/${leave.body.id}/decide`).set(auth(h.staff.reception!)).send({ approve: true }).expect(403); // no hr:approve
    await h.http().post(`/v1/hr/leave-requests/${leave.body.id}/decide`).set(auth(h.staff.manager!)).send({ approve: true }).expect(200);
    const unpaid = await h.http().post('/v1/hr/leave-requests').set(auth(h.staff.manager!)).send({ userId: id.reception, leaveTypeId: type('unpaid'), startDate: '2026-10-11', endDate: '2026-10-11', reason: 'ظرف خاص' });
    expect(unpaid.status).toBe(201);
    await h.http().post(`/v1/hr/leave-requests/${unpaid.body.id}/decide`).set(auth(h.staff.manager!)).send({ approve: true }).expect(200);

    const bal = await h.http().get('/v1/hr/me/balances?year=2026').set(auth(h.staff.reception!));
    expect(bal.body.annual).toMatchObject({ entitled: 15, used: 1 }); // first year, joined in January: 15 days

    // Permission for a late arrival on Monday 5 October excuses the first hour.
    const perm = await h.http().post('/v1/hr/permission-requests').set(auth(h.staff.reception!)).send({ workDate: '2026-10-05', kind: 'late_arrival', startTime: '09:00', endTime: '10:00', reason: 'موعد طبيب' });
    expect(perm.status, JSON.stringify(perm.body)).toBe(201);
    await h.http().post('/v1/hr/permission-requests').set(auth(h.staff.reception!)).send({ workDate: '2026-10-12', kind: 'early_leave', startTime: '16:00', endTime: '17:00' }).expect(201);
    expect((await h.http().post('/v1/hr/permission-requests').set(auth(h.staff.reception!)).send({ workDate: '2026-10-13', kind: 'early_leave', startTime: '16:30', endTime: '17:00' })).body.error).toBe('permission_allowance_exceeded');

    const day5 = await h.http().put('/v1/hr/attendance').set(auth(h.staff.manager!)).send({ userId: id.reception, workDate: '2026-10-05', clockIn: '10:00', clockOut: '17:00', reason: 'نسيت تسجيل الحضور' });
    expect(day5.body.late_minutes).toBe(60); // permission still pending
    await h.http().post(`/v1/hr/permission-requests/${perm.body.id}/decide`).set(auth(h.staff.manager!)).send({ approve: true }).expect(200);
    const after = await admin.query(`select late_minutes from attendance_records where user_id = $1 and work_date = '2026-10-05'`, [id.reception]);
    expect(after.rows[0].late_minutes).toBe(0);

    // Saturday 3 October: 40 minutes late (beyond grace) and an hour of overtime that needs approval.
    const day3 = await h.http().put('/v1/hr/attendance').set(auth(h.staff.manager!)).send({ userId: id.reception, workDate: '2026-10-03', clockIn: '09:40', clockOut: '18:00', reason: 'تصحيح من الكشف الورقي' });
    expect(day3.body).toMatchObject({ late_minutes: 40, overtime_minutes: 60, overtime_approved: false });
    await h.http().post(`/v1/hr/attendance/${day3.body.id}/overtime`).set(auth(h.staff.manager!)).send({ approved: true }).expect(200);
    // Friday 9 October is a rest day: all of it is rest-day overtime.
    const fri = await h.http().put('/v1/hr/attendance').set(auth(h.staff.manager!)).send({ userId: id.reception, workDate: '2026-10-09', clockIn: '10:00', clockOut: '14:00', reason: 'تغطية وردية' });
    expect(fri.body).toMatchObject({ rest_day: true, overtime_minutes: 240 });
    await h.http().post(`/v1/hr/attendance/${fri.body.id}/overtime`).set(auth(h.staff.manager!)).send({ approved: true }).expect(200);

    const board = await h.http().get('/v1/hr/attendance?date=2026-10-07').set(auth(h.staff.manager!));
    expect(board.body.find((r: { userId: string }) => r.userId === id.reception).state).toBe('on_leave');
  });

  it('marks absences when closing a day', async () => {
    const n = await h.app.get(Tenancy).system(h.env.demo.orgId, (tx) => h.app.get(HrService).closeDay(tx, '2026-10-14'));
    expect(n).toBeGreaterThanOrEqual(3);
    const r = await admin.query(`select status from attendance_records where user_id = $1 and work_date = '2026-10-14'`, [id.nurse]);
    expect(r.rows[0].status).toBe('absent');
  });

  it('builds, approves and exports a monthly payroll', async () => {
    await admin.query(
      `insert into commission_statements (organisation_id, doctor_id, clinic_id, month, revenue, share, lines, status) values ($1,$2,$3,'2026-10-01', 5000000, 1500000, '[]', 'approved')`,
      [h.env.demo.orgId, id.dr_ahmed, id.clinic],
    );
    await h.http().post('/v1/payroll/adjustments').set(auth(h.staff.accountant!)).send({ userId: id.reception, month: '2026-10', kind: 'bonus', amount: 500 * EGP, note: 'Excellent patient feedback' }).expect(201);
    const run = await h.http().post('/v1/payroll/runs').set(auth(h.staff.accountant!)).send({ month: '2026-10' });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body.status).toBe('draft');
    expect(run.body.warnings).toContain('social_insurance_limits_outdated'); // defaults hold 2025 limits
    const slip = (uid: string) => run.body.payslips.find((x: { user_id: string }) => x.user_id === uid);

    const rec = slip(id.reception);
    expect(rec.inputs).toMatchObject({ leaveDays: 2, unpaidLeaveDays: 1, overtimeMinutes: 60, restDayOvertimeMinutes: 240, latenessMinutes: 40 });
    // October 2026 has 21 Saturday–Wednesday days; minus the 6 October holiday = 20; worked 2 (3rd, 5th); leave 2 (7th, 11th) → 16 absences.
    expect(rec.inputs.absentDays).toBe(16);
    const line = (code: string) => rec.lines.find((l: { code: string }) => l.code === code)?.amount;
    expect(line('base')).toBe(900000);
    expect(line('absence')).toBe(16 * 30000); // daily rate 300 EGP
    expect(line('unpaid_leave')).toBe(30000);
    expect(line('overtime')).toBe(Math.round((3750 * 60 * 1.35) / 60)); // hourly 37.50 EGP
    expect(line('overtime_rest')).toBe(Math.round((3750 * 240 * 2) / 60));
    expect(line('bonus')).toBe(50000);
    expect(line('social_insurance')).toBe(66000); // 11% of 6,000
    expect(slip(id.dr_ahmed).gross).toBe(1500000);

    await h.http().post(`/v1/payroll/runs/${run.body.id}/approve`).set(auth(h.staff.accountant!)).expect(403); // accountants prepare, others approve
    const approved = await h.http().post(`/v1/payroll/runs/${run.body.id}/approve`).set(auth(h.staff.director!));
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect((await h.http().post('/v1/payroll/adjustments').set(auth(h.staff.accountant!)).send({ userId: id.reception, month: '2026-10', kind: 'bonus', amount: 100, note: 'late' })).body.error).toBe('payroll_period_closed');
    expect((await h.http().post('/v1/payroll/runs').set(auth(h.staff.accountant!)).send({ month: '2026-10' })).body.error).toBe('payroll_run_exists');

    const bank = await h.http().get(`/v1/payroll/runs/${run.body.id}/bank-file.csv`).set(auth(h.staff.accountant!));
    expect(bank.text).toContain('EG380019000500000000263180002');
    expect(bank.text).toContain(`${(rec.net / 100).toFixed(2)},SAL-2026-10`);

    const mine = await h.http().get('/v1/payroll/me/payslips').set(auth(h.staff.reception!));
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].net).toBe(rec.net);
    const pdf = await h.http().get(`/v1/payroll/payslips/${mine.body[0].id}/pdf`).set(auth(h.staff.reception!));
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await h.http().get(`/v1/payroll/payslips/${mine.body[0].id}/pdf`).set(auth(h.staff.nurse!)).expect(404); // someone else's payslip
  }, 60000);
});
