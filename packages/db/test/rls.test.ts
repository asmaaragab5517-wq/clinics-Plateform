import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { Database } from '../src';
import { createTestDatabase } from '../../testkit/src';

let env: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let patientA: string;
let patientB: string;

beforeAll(async () => {
  env = await createTestDatabase('hf_test_db_rls');
  db = new Database(env.appUrl, 4);
  const c = new Client({ connectionString: env.adminUrl });
  await c.connect();
  const mk = async (org: string, name: string) =>
    (await c.query(`insert into patients (organisation_id, mrn, first_name_ar, date_of_birth, gender) values ($1, $2, $3, '1990-01-01', 'female') returning id`, [org, `T-${name}`, name])).rows[0].id;
  patientA = await mk(env.demo.orgId, 'A');
  patientB = await mk(env.demo.orgId, 'B');
  await mk(env.other.orgId, 'X');
  await c.end();
}, 60000);
afterAll(async () => {
  await db?.close();
  await env?.drop();
});

describe('row-level security (MT-1..MT-4)', () => {
  it('app role cannot bypass RLS', async () => {
    const r = await db.raw<{ rolbypassrls: boolean }>(`select rolbypassrls from pg_roles where rolname = current_user`);
    expect(r[0]!.rolbypassrls).toBe(false);
    expect(await db.raw('select * from patients')).toHaveLength(0);
  });

  it('staff see only their organisation', async () => {
    const rows = await db.withTenant({ orgId: env.demo.orgId, mode: 'staff', network: true }, (tx) => tx.query('select organisation_id from patients'));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.organisation_id === env.demo.orgId)).toBe(true);
  });

  it('cannot insert into another organisation', async () => {
    await expect(
      db.withTenant({ orgId: env.demo.orgId, mode: 'staff', network: true }, (tx) =>
        tx.query(`insert into patients (organisation_id, mrn, first_name_ar, date_of_birth, gender) values ($1,'x','x','1990-01-01','male')`, [env.other.orgId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('clinic-scoped staff see only member clinics', async () => {
    const [c1, c2] = env.demo.clinicIds;
    const rows = await db.withTenant({ orgId: env.demo.orgId, mode: 'staff', clinicIds: [c1!] }, (tx) => tx.query('select distinct clinic_id from doctor_sessions'));
    expect(rows.map((r) => r.clinic_id)).toEqual([c1]);
    const clinics = await db.withTenant({ orgId: env.demo.orgId, mode: 'staff', clinicIds: [c2!] }, (tx) => tx.query('select id from clinics'));
    expect(clinics.map((r) => r.id)).toEqual([c2]);
  });

  it('patients see only themselves and linked family', async () => {
    const rows = await db.withTenant({ orgId: env.demo.orgId, mode: 'patient', patientIds: [patientA] }, (tx) => tx.query('select id from patients'));
    expect(rows.map((r) => r.id)).toEqual([patientA]);
    const none = await db.withTenant({ orgId: env.demo.orgId, mode: 'patient', patientIds: [patientA] }, (tx) => tx.query('select id from patients where id = $1', [patientB]));
    expect(none).toHaveLength(0);
  });

  it('public sessions read catalogue but no patient or staff-only data', async () => {
    await db.withTenant({ orgId: env.demo.orgId, mode: 'public' }, async (tx) => {
      expect((await tx.query('select id from clinics')).length).toBe(2);
      expect((await tx.query('select id from patients')).length).toBe(0);
      expect((await tx.query('select id from legal_entities')).length).toBe(0);
      expect((await tx.query('select id from users')).length).toBe(3); // public doctors only
      await expect(tx.query(`update clinics set name_ar = 'x'`)).resolves.toBeDefined();
      expect((await tx.query(`select name_ar from clinics where name_ar = 'x'`)).length).toBe(0);
    });
  });

  it('audit log is hash chained, append-only and verifiable', async () => {
    await db.withTenant({ orgId: env.demo.orgId, mode: 'staff', network: true }, async (tx) => {
      for (let i = 0; i < 3; i++) {
        await tx.query(`select audit_append('user', null, 'owner', 'patient.read', 'patient', $1, $2::uuid, null, '127.0.0.1', 'test', null, '{"i":1}')`, [patientA, patientA]);
      }
      const v = await tx.one<{ broken: string | null }>('select audit_verify($1) as broken', [env.demo.orgId]);
      expect(v.broken).toBeNull();
    });
    await expect(
      db.withTenant({ orgId: env.demo.orgId, mode: 'staff', network: true }, (tx) => tx.query('update audit_log set action = $1', ['x'])),
    ).rejects.toThrow();
    const c = new Client({ connectionString: env.adminUrl });
    await c.connect();
    await expect(c.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
    // Tamper by bypassing the trigger as superuser and confirm verification catches it.
    await c.query('alter table audit_log disable trigger audit_no_update');
    await c.query(`update audit_log set action = 'tampered' where organisation_id = $1 and seq = 2`, [env.demo.orgId]);
    await c.query('alter table audit_log enable trigger audit_no_update');
    const r = await c.query('select audit_verify($1) as broken', [env.demo.orgId]);
    expect(Number(r.rows[0].broken)).toBe(2);
    await c.end();
  });

  it('exclusion constraint prevents double booking the same capacity slot', async () => {
    const ctx = { orgId: env.demo.orgId, mode: 'staff' as const, network: true };
    const doctor = env.demo.doctorIds[0]!;
    const clinic = env.demo.clinicIds[0]!;
    const ins = (ref: string, slot = 0) =>
      db.withTenant(ctx, (tx) =>
        tx.query(
          `insert into appointments (organisation_id, clinic_id, doctor_id, patient_id, ref, start_at, end_at, slot_index, channel)
           values ($1,$2,$3,$4,$5,'2030-01-05T15:00:00Z','2030-01-05T15:20:00Z',$6,'console')`,
          [env.demo.orgId, clinic, doctor, patientA, ref, slot],
        ),
      );
    await ins('R1');
    await expect(ins('R2')).rejects.toThrow(/appointments_no_overlap/);
    await expect(ins('R3', 1)).resolves.toBeDefined();
  });

  it('next_number is atomic per scope', async () => {
    const ctx = { orgId: env.demo.orgId, mode: 'system' as const };
    const nums = await Promise.all(Array.from({ length: 5 }, () => db.withTenant(ctx, (tx) => tx.one<{ n: string }>(`select next_number('test') as n`))));
    expect(nums.map((n) => Number(n.n)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
