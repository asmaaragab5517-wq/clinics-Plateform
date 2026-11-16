/**
 * MT-5 isolation suite: every API route × every role × a foreign organisation / clinic / patient.
 * A request that names a foreign entity must never succeed, and no successful response may contain a
 * foreign identifier. Runs in CI and blocks merge on any failure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PATH_METADATA, METHOD_METADATA, SSE_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { CONTROLLERS } from '../src/app.module';
import { ACCESS_KEY } from '../src/common/decorators';
import { auth, nationalIdFor, patientLogin, startHarness, type Harness } from './harness';

interface Route { method: string; path: string; access: string | undefined; sse: boolean; handler: string }

function routes(): Route[] {
  const out: Route[] = [];
  for (const ctrl of CONTROLLERS) {
    const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
    const classAccess = Reflect.getMetadata(ACCESS_KEY, ctrl);
    for (const key of Object.getOwnPropertyNames(ctrl.prototype)) {
      const fn = (ctrl.prototype as unknown as Record<string, unknown>)[key] as object;
      if (key === 'constructor' || typeof fn !== 'function') continue;
      const sub = Reflect.getMetadata(PATH_METADATA, fn);
      if (sub === undefined) continue;
      const m = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod;
      const path = ('/' + [base, String(sub)].filter((x) => x && x !== '/').join('/')).replace(/\/+/g, '/');
      out.push({ method: RequestMethod[m]!.toLowerCase(), path, access: Reflect.getMetadata(ACCESS_KEY, fn) ?? classAccess, sse: !!Reflect.getMetadata(SSE_METADATA, fn), handler: `${ctrl.name}.${key}` });
    }
  }
  return out;
}

let h: Harness;
let foreign: Record<string, string>; // entity kind → foreign id (other organisation)
let sibling: Record<string, string>; // entity kind → same-org other patient's ids (for the patient persona)
let patientToken = '';
const forbiddenIds = new Set<string>();
/** Patient-owned ids of the same-org sibling (clinic, doctor, service ids are public catalogue). */
const siblingPrivate = new Set<string>();

async function seedForeign(c: Client, org: string, clinic: string, doctor: string, userAny: string, label: string, phone: string) {
  const q = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows[0].id as string;
  const patient = await q(`insert into patients (organisation_id, mrn, first_name_ar, date_of_birth, gender) values ($1, $2, 'غريب', '1980-01-01', 'male') returning id`, [org, `X-${label}`]);
  await c.query(`insert into patient_contacts (organisation_id, patient_id, phone, is_primary) values ($1,$2,$3,true)`, [org, patient, phone]);
  const service = (await c.query(`select id from services where organisation_id = $1 limit 1`, [org])).rows[0].id;
  const appointment = await q(`insert into appointments (organisation_id, clinic_id, doctor_id, patient_id, ref, start_at, end_at, status, channel, slot_index) values ($1,$2,$3,$4,$5, now() + interval '3 days', now() + interval '3 days 20 minutes', 'completed', 'console', 7) returning id`, [org, clinic, doctor, patient, `F${label}`]);
  await c.query(`insert into appointment_services (organisation_id, appointment_id, service_id) values ($1,$2,$3)`, [org, appointment, service]);
  const encounter = await q(`insert into encounters (organisation_id, clinic_id, doctor_id, patient_id, appointment_id) values ($1,$2,$3,$4,$5) returning id`, [org, clinic, doctor, patient, appointment]);
  const prescription = await q(`insert into prescriptions (organisation_id, clinic_id, encounter_id, patient_id, doctor_id, verify_code, status, issued_at) values ($1,$2,$3,$4,$5,$6,'issued',now()) returning id`, [org, clinic, encounter, patient, doctor, `vc-${label}`]);
  const bill = await q(`insert into bills (organisation_id, clinic_id, patient_id, appointment_id, number, status, total, paid, issued_at) values ($1,$2,$3,$4,$5,'paid',1000,1000,now()) returning id`, [org, clinic, patient, appointment, `INV-${label}`]);
  const shift = await q(`insert into cashier_shifts (organisation_id, clinic_id, cashier_id, opening_float, status) values ($1,$2,$3,0,'closed') returning id`, [org, clinic, userAny]);
  const payment = await q(`insert into payments (organisation_id, clinic_id, bill_id, patient_id, method, amount, receipt_number, shift_id) values ($1,$2,$3,$4,'cash',1000,$5,$6) returning id`, [org, clinic, bill, patient, `RC-${label}`, shift]);
  const refund = await q(`insert into refunds (organisation_id, clinic_id, payment_id, patient_id, amount, reason) values ($1,$2,$3,$4,100,'x') returning id`, [org, clinic, payment, patient]);
  const order = await q(`insert into orders (organisation_id, encounter_id, patient_id, kind, test_codes, status) values ($1,$2,$3,'lab','{CBC}','result_received') returning id`, [org, encounter, patient]);
  const document = await q(`insert into documents (organisation_id, patient_id, encounter_id, title, storage_key, mime, size_bytes, sha256, scan_status) values ($1,$2,$3,'doc','k','application/pdf',1,'x','clean') returning id`, [org, patient, encounter]);
  const review = await q(`insert into reviews (organisation_id, clinic_id, doctor_id, patient_id, appointment_id, rating, display_name) values ($1,$2,$3,$4,$5,4,'x') returning id`, [org, clinic, doctor, patient, appointment]);
  const ticket = await q(`insert into queue_tickets (organisation_id, clinic_id, doctor_id, appointment_id, patient_id, queue_date, ticket_number) values ($1,$2,$3,$4,$5,current_date,99) returning id`, [org, clinic, doctor, appointment, patient]);
  const history = await q(`insert into medical_history_items (organisation_id, patient_id, kind, text) values ($1,$2,'allergy','x') returning id`, [org, patient]);
  const dataRequest = await q(`insert into data_requests (organisation_id, patient_id, kind, due_at) values ($1,$2,'export', now() + interval '30 days') returning id`, [org, patient]);
  const approval = await q(`insert into approval_requests (organisation_id, clinic_id, kind, entity_id, requested_by) values ($1,$2,'void',$3,$4) returning id`, [org, clinic, bill, userAny]);
  const task = await q(`insert into tasks (organisation_id, clinic_id, kind, title) values ($1,$2,'x','x') returning id`, [org, clinic]);
  const merge = await q(`insert into patient_merges (organisation_id, source_patient_id, target_patient_id, moved) values ($1,$2,$2,'{}') returning id`, [org, patient]);
  const breach = await q(`insert into breaches (organisation_id, title, description, detected_at) values ($1,'x','xxxxxxxxxx',now()) returning id`, [org]);
  const article = await q(`insert into articles (organisation_id, slug, title_ar) values ($1,$2,'x') returning id`, [org, `a-${label}`]);
  const importBatch = await q(`insert into import_batches (organisation_id, entity, status) values ($1,'patients','validated') returning id`, [org]);
  const session = (await c.query(`select id from doctor_sessions where organisation_id = $1 limit 1`, [org])).rows[0].id;
  const exception = await q(`insert into schedule_exceptions (organisation_id, clinic_id, kind, date) values ($1,$2,'holiday','2031-01-01') returning id`, [org, clinic]);
  const legalEntity = (await c.query(`select id from legal_entities where organisation_id = $1 limit 1`, [org])).rows[0].id;
  const statement = await q(`insert into commission_statements (organisation_id, doctor_id, clinic_id, month, revenue, share, lines) values ($1,$2,$3,'2026-10-01',1,1,'[]') returning id`, [org, doctor, clinic]);
  const template = (await c.query(`select id from message_templates where organisation_id = $1 limit 1`, [org])).rows[0].id;
  return { patient, appointment, encounter, prescription, bill, shift, payment, refund, order, document, review, ticket, history, dataRequest, approval, task, merge, breach, article, importBatch, session, exception, legalEntity, statement, template, service, clinic, user: doctor };
}

const ENTITY_BY_SEGMENT: Record<string, string> = {
  patients: 'patient', appointments: 'appointment', bills: 'bill', encounters: 'encounter', prescriptions: 'prescription', clinics: 'clinic', staff: 'user', doctors: 'user',
  sessions: 'session', 'schedule-exceptions': 'exception', orders: 'order', documents: 'document', refunds: 'refund', shifts: 'shift', queue: 'ticket', approvals: 'approval',
  reviews: 'review', tasks: 'task', imports: 'importBatch', articles: 'article', 'data-requests': 'dataRequest', breaches: 'breach', services: 'service', 'legal-entities': 'legalEntity',
  'commission-statements': 'statement', 'message-templates': 'template', invoices: 'bill', preferences: 'patient', merges: 'merge', history: 'history',
};
const FIXED: Record<string, string> = { role: 'nurse', kind: 'signature', entity: 'patients', token: 'x.1.y', code: 'nope', slug: 'nasr-city', providerOrderId: 'x' };

function fill(path: string, ids: Record<string, string>): { url: string; foreignParam: boolean } {
  const segs = path.split('/');
  let foreignParam = false;
  const out = segs.map((s, i) => {
    if (!s.startsWith(':')) return s;
    const name = s.slice(1);
    if (FIXED[name]) return FIXED[name];
    const kind = name === 'patientId' ? 'patient' : name === 'mergeId' ? 'merge' : name === 'itemId' ? 'history' : ENTITY_BY_SEGMENT[segs[i - 1]!];
    if (!kind || !ids[kind]) throw new Error(`no foreign id mapping for ${path} (${name})`);
    foreignParam = true;
    return ids[kind];
  });
  return { url: out.join('/'), foreignParam };
}

/** Valid bodies that reference foreign entities for the main write routes. */
function bodyFor(r: Route, ids: Record<string, string>, own: Record<string, string>) {
  const start = new Date(Date.now() + 5 * 86400000).toISOString();
  const common = { patientId: ids.patient, clinicId: ids.clinic, doctorId: ids.user, appointmentId: ids.appointment, encounterId: ids.encounter, serviceId: ids.service, paymentId: ids.payment };
  const map: Record<string, unknown> = {
    'post /v1/appointments': { ...common, serviceIds: [ids.service], start, channel: 'console' },
    'post /v1/appointments/walk-in': { ...common, serviceIds: [ids.service] },
    'post /v1/bills': { clinicId: own.clinic, patientId: ids.patient, appointmentId: ids.appointment, lines: [{ serviceId: ids.service, qty: 1 }] },
    'post /v1/refunds': { paymentId: ids.payment, amount: 100, reason: 'test refund' },
    'post /v1/waitlist': { ...common, earliest: '2031-01-01' },
    'post /v1/sessions': { clinicId: ids.clinic, doctorId: ids.user, weekdays: [1], startTime: '10:00', endTime: '11:00', slotMinutes: 20, effectiveFrom: '2031-01-01' },
    'put /v1/doctors/:id/services': { serviceIds: [ids.service] },
    'put /v1/staff/:id/memberships': { memberships: [{ role: 'nurse', clinicId: ids.clinic }] },
    'post /v1/prices': { clinicId: ids.clinic, serviceId: ids.service, price: 1, effectiveFrom: '2031-01-01' },
    'post /v1/packages': { serviceId: ids.service, name: { ar: 'x', en: 'x' }, sessions: 1, validityDays: 1, price: 1 },
    'post /v1/commission-rules': { doctorId: ids.user, rule: { kind: 'percent', percent: 10 } },
    'post /v1/patients/:id/merge': { sourcePatientId: own.patient, reason: 'isolation test' },
    'post /v1/patients/:id/family': { guardianPatientId: own.patient },
    'post /v1/schedule-exceptions': { kind: 'leave', doctorId: ids.user, date: '2031-01-02' },
    'post /v1/queue/call-next': { clinicId: ids.clinic, doctorId: ids.user },
    'post /v1/shifts': { clinicId: ids.clinic, openingFloat: 0 },
    'post /v1/portal/bookings': { clinicId: ids.clinic, doctorId: ids.user, serviceId: ids.service, start, patientId: ids.patient, paymentMode: 'at_clinic' },
    'post /v1/portal/reviews': { appointmentId: ids.appointment, rating: 5 },
    'post /v1/portal/consents': { patientId: ids.patient, type: 'marketing', granted: true, versionId: ids.patient },
    'post /v1/portal/data-requests': { patientId: ids.patient, kind: 'export' },
    'post /v1/portal/documents': { patientId: ids.patient },
    'post /v1/encounters/:id/prescriptions': { lines: [{ freeText: 'x', dose: '1', frequency: 'x' }] },
    'post /v1/bills/:id/payments': { method: 'card_at_clinic', amount: 1, reference: 'x' },
    'post /v1/approvals/:id/decision': { approve: true },
    'post /v1/refunds/:id/decision': { approve: true },
    'post /v1/reviews/:id/moderate': { approve: true },
    'post /v1/privacy/data-requests/:id/process': { action: 'complete' },
    'post /v1/appointments/:id/transition': { to: 'cancelled', reason: 'x' },
    'post /v1/portal/appointments/:id/cancel': { reason: 'xx' },
    'post /v1/patients/:id/break-glass': { reason: 'isolation test reason' },
    'patch /v1/patients/:id': { occupation: 'x' },
    'patch /v1/encounters/:id': { notes: 'x' },
    'post /v1/encounters/:id/vitals': { systolic: 120 },
    'post /v1/encounters/:id/addenda': { body: 'x' },
    'post /v1/encounters/:id/orders': { kind: 'lab', testCodes: ['CBC'] },
    'post /v1/patients/:id/history': { kind: 'allergy', text: 'x' },
    'post /v1/patients/:id/consents': { consents: { marketing: true } },
    'post /v1/patients/:id/link-account': { phone: '01012121212', relation: 'child' },
    'post /v1/bills/:id/void': { reason: 'isolation' },
    'post /v1/bills/:id/credit-notes': { amount: 1, reason: 'isolation' },
    'post /v1/prescriptions/:id/revoke': { reason: 'isolation' },
    'post /v1/shifts/:id/close': { counts: {} },
    'patch /v1/queue/:id': { priority: 'emergency' },
    'patch /v1/clinics/:id': { invoiceFooter: 'x' },
    'patch /v1/services/:id': { durationMinutes: 30 },
    'patch /v1/sessions/:id': { isActive: false },
    'patch /v1/articles/:id': { titleAr: 'x' },
    'patch /v1/privacy/breaches/:id': { note: 'x' },
    'patch /v1/message-templates/:id': { isEnabled: false },
    'put /v1/doctors/:id/profile': { title: 'dr', specialtyIds: [], syndicateNumber: '12345', slug: 'iso-test' },
    'put /v1/legal-entities/:id/healthpay': { merchantId: 'x', apiKey: 'xxxxxxxxxx', mode: 'sandbox' },
    'patch /v1/portal/preferences/:patientId': { channels: ['sms'], marketingOptOut: true, smsOptOut: false, whatsappOptOut: false },
  };
  return map[`${r.method} ${r.path}`] ?? {};
}

beforeAll(async () => {
  h = await startHarness('hf_test_api_isolation');
  const c = new Client({ connectionString: h.env.adminUrl });
  await c.connect();
  const other = h.env.other;
  foreign = await seedForeign(c, other.orgId, other.clinicIds[0]!, other.doctorIds[0]!, other.staff.reception!, 'O', '+201077778888');
  // Same-organisation sibling patient: invisible to patient persona A.
  sibling = await seedForeign(c, h.env.demo.orgId, h.env.demo.clinicIds[0]!, h.env.demo.doctorIds[0]!, h.env.demo.staff.reception!, 'S', '+201066667777');
  await c.end();
  for (const v of Object.values(foreign)) forbiddenIds.add(v);
  for (const [k, v] of Object.entries(sibling)) if (!['clinic', 'user', 'service', 'session', 'legalEntity', 'template', 'article', 'exception', 'statement', 'task', 'breach', 'importBatch', 'approval', 'shift'].includes(k)) siblingPrivate.add(v);
  forbiddenIds.add(h.env.other.orgId);
  // Patient persona A with a record of their own.
  const t = await patientLogin(h, '01033334444');
  patientToken = t.accessToken;
  const r = await h.http().post('/v1/portal/patients').set(auth(patientToken)).send({ relation: 'self', consentHealthData: true, patient: { nameAr: { first: 'نور', family: 'علي' }, dateOfBirth: '1995-01-01', gender: 'female', nationalId: nationalIdFor('1995-01-01', 'female', 9), phones: [{ number: '01033334444', primary: true }] } });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
}, 240000);

afterAll(async () => h?.close());

describe('MT-5 isolation suite', () => {
  it('every route declares an access policy (deny by default)', () => {
    const missing = routes().filter((r) => !r.access).map((r) => `${r.method.toUpperCase()} ${r.path} (${r.handler})`);
    expect(missing).toEqual([]);
  });

  it('unauthenticated callers are refused on every staff and patient route', async () => {
    const failures: string[] = [];
    for (const r of routes().filter((x) => (x.access === 'staff' || x.access === 'patient' || x.access === 'display') && !x.sse)) {
      const { url } = fill(r.path, foreign);
      const res = await (h.http() as never as Record<string, (u: string) => import('supertest').Test>)[r.method]!(url).set('x-org', 'demo');
      if (res.status !== 401 && res.status !== 403) failures.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  }, 120000);

  it('no role can read or write another organisation\'s or another patient\'s data', async () => {
    const personas: [string, string, Record<string, string>][] = [
      ...Object.entries(h.staff).map(([k, v]) => [k, v, foreign] as [string, string, Record<string, string>]),
      ['patient', patientToken, foreign],
      ['patient-vs-sibling', patientToken, sibling],
    ];
    const failures: string[] = [];
    const own = { clinic: h.env.demo.clinicIds[0]!, patient: sibling.patient! };
    for (const r of routes().filter((x) => !x.sse && x.access !== 'webhook' && !x.path.startsWith('/v1/dev'))) {
      for (const [name, token, ids] of personas) {
        if (r.access === 'patient' && !name.startsWith('patient')) continue;
        if (r.access === 'staff' && name.startsWith('patient')) continue;
        const { url, foreignParam } = fill(r.path, ids);
        const body = bodyFor(r, ids, own);
        const sep = url.includes('?') ? '&' : '?';
        const qs = r.method === 'get' ? `${sep}clinicId=${ids.clinic}&patientId=${ids.patient}&doctorId=${ids.user}&from=2026-01-01&to=2031-12-31` : '';
        const req = (h.http() as never as Record<string, (u: string) => import('supertest').Test>)[r.method]!(url + qs).set(auth(token)).set('x-org', 'demo');
        const res = r.method === 'get' || r.method === 'delete' ? await req : await req.send(body as object);
        const ok = res.status >= 200 && res.status < 300;
        const text = res.text ?? '';
        const forbiddenSet = name === 'patient-vs-sibling' ? siblingPrivate : forbiddenIds;
        const leaked = [...forbiddenSet].find((id) => text.includes(id));
        const referencesForeign = foreignParam || (r.method !== 'get' && JSON.stringify(body).match(/[0-9a-f]{8}-[0-9a-f]{4}/) && Object.values(ids).some((id) => JSON.stringify(body).includes(id)));
        if (ok && referencesForeign) failures.push(`${name}: ${r.method.toUpperCase()} ${r.path} → ${res.status} accepted a foreign reference`);
        else if (ok && leaked) failures.push(`${name}: ${r.method.toUpperCase()} ${r.path} leaked ${leaked}`);
        if (res.status >= 500) failures.push(`${name}: ${r.method.toUpperCase()} ${r.path} → ${res.status} ${text.slice(0, 120)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 600000);
});
