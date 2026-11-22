import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, startHarness, type Harness } from './harness';

let h: Harness;
const ctx: Record<string, string> = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeAll(async () => {
  h = await startHarness('hf_test_api_s22');
  const pt = await h.http().post('/v1/patients').set(auth(h.staff.reception!)).send({
    patient: { nameAr: { first: 'سلمى', family: 'حسن' }, dateOfBirth: '1990-05-05', gender: 'female', phones: [{ number: '01033334444', primary: true }] },
    consents: { healthData: true },
  });
  if (pt.status !== 201) throw new Error(JSON.stringify(pt.body));
  ctx.patient = pt.body.id;
  const def = await h.http().post('/v1/custom-fields').set(auth(h.staff.owner!)).send({ key: 'id_copy', labelAr: 'صورة البطاقة', labelEn: 'ID copy', type: 'file' });
  if (def.status !== 201) throw new Error(JSON.stringify(def.body));
  const clinics = await h.http().get('/v1/clinics').set(auth(h.staff.owner!));
  ctx.clinic = clinics.body[0].id;
}, 180000);
afterAll(async () => {
  await h?.close();
});

describe('custom-field files (patient:edit, no clinical privilege)', () => {
  it('lets reception attach a file to the field and open it again', async () => {
    const cannot = await h.http().post(`/v1/patients/${ctx.patient}/documents`).set(auth(h.staff.reception!)).attach('file', PDF, 'id.pdf');
    expect(cannot.status).toBe(403); // the general clinical document upload still needs emr:create
    const up = await h.http().post(`/v1/patients/${ctx.patient}/custom-fields/id_copy/file`).set(auth(h.staff.reception!)).attach('file', PDF, 'id.pdf');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body).toMatchObject({ key: 'id_copy', name: 'id.pdf' });
    const pt = await h.http().get(`/v1/patients/${ctx.patient}`).set(auth(h.staff.reception!));
    expect(pt.body.custom_fields?.id_copy ?? pt.body.customFields?.id_copy).toMatchObject({ documentId: up.body.documentId, name: 'id.pdf' });
    const link = await h.http().get(`/v1/patients/${ctx.patient}/custom-fields/id_copy/file`).set(auth(h.staff.reception!));
    expect(link.status).toBe(200);
    expect(link.body.url).toBeTruthy();
  });

  it('refuses fields that are not file fields, and unsupported files', async () => {
    expect((await h.http().post(`/v1/patients/${ctx.patient}/custom-fields/nope/file`).set(auth(h.staff.reception!)).attach('file', PDF, 'x.pdf')).status).toBe(404);
    const bad = await h.http().post(`/v1/patients/${ctx.patient}/custom-fields/id_copy/file`).set(auth(h.staff.reception!)).attach('file', Buffer.from('just text'), 'x.txt');
    expect(bad.body.error).toBe('unsupported_file_type');
    expect((await h.http().get(`/v1/patients/${ctx.patient}/custom-fields/other/file`).set(auth(h.staff.reception!))).status).toBe(404);
  });
});

describe('re-consent signed on the tablet', () => {
  it('stores the signature and lets staff open it later, audited', async () => {
    const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
    const r = await h.http().post(`/v1/patients/${ctx.patient}/consents`).set(auth(h.staff.reception!)).send({ consents: { marketing: true }, signatureDataUrl: png });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const pt = await h.http().get(`/v1/patients/${ctx.patient}`).set(auth(h.staff.reception!));
    const c = pt.body.consents.find((x: { type: string }) => x.type === 'marketing');
    expect(c).toMatchObject({ channel: 'reception', signed: true });
    const unsigned = pt.body.consents.find((x: { type: string }) => x.type === 'health_data');
    expect(unsigned.signed).toBe(false);
    const link = await h.http().get(`/v1/patients/${ctx.patient}/consents/${c.id}/signature`).set(auth(h.staff.reception!));
    expect(link.status).toBe(200);
    expect(link.body.url).toBeTruthy();
    expect((await h.http().get(`/v1/patients/${ctx.patient}/consents/${unsigned.id}/signature`).set(auth(h.staff.reception!))).status).toBe(404);
  });
});

describe('clinic map position', () => {
  it('sets, protects and clears the position', async () => {
    const set = await h.http().patch(`/v1/clinics/${ctx.clinic}`).set(auth(h.staff.owner!)).send({ lat: 30.0444, lng: 31.2357 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((await h.http().patch(`/v1/clinics/${ctx.clinic}`).set(auth(h.staff.owner!)).send({ lat: 30.1 })).body.error).toBe('position_needs_lat_and_lng');
    expect((await h.http().patch(`/v1/clinics/${ctx.clinic}`).set(auth(h.staff.owner!)).send({ lat: 30.1, lng: 31, clearPosition: true })).body.error).toBe('position_conflict');
    const rules = await h.http().put(`/v1/hr/clinics/${ctx.clinic}/attendance-rules`).set(auth(h.staff.owner!)).send({ mode: 'flag', allowedNetworks: [], geofenceMeters: 150 });
    expect(rules.status, JSON.stringify(rules.body)).toBe(200);
    const inUse = await h.http().patch(`/v1/clinics/${ctx.clinic}`).set(auth(h.staff.owner!)).send({ clearPosition: true });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error).toBe('clinic_location_in_use');
    await h.http().put(`/v1/hr/clinics/${ctx.clinic}/attendance-rules`).set(auth(h.staff.owner!)).send({ mode: 'off', allowedNetworks: [], geofenceMeters: null });
    const cleared = await h.http().patch(`/v1/clinics/${ctx.clinic}`).set(auth(h.staff.owner!)).send({ clearPosition: true });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.lat).toBeNull();
    expect(cleared.body.lng).toBeNull();
  });
});
