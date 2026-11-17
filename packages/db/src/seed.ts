import { Client } from 'pg';
import { MESSAGE_EVENTS, catalogs } from '@hf/shared';
import { SecretBox } from './crypto';
import { DRUGS, ENCOUNTER_TEMPLATES, ICD10, INTERACTIONS, LAB_TESTS, SPECIALTIES } from './reference-data';

export async function seedReference(c: Client) {
  for (const s of SPECIALTIES) {
    await c.query('insert into specialties (slug, name_ar, name_en) values ($1,$2,$3) on conflict (slug) do nothing', [s.slug, s.ar, s.en]);
  }
  for (const d of ICD10) {
    await c.query('insert into icd10_codes (code, title_en, title_ar) values ($1,$2,$3) on conflict do nothing', [d.code, d.en, d.ar]);
  }
  for (const t of LAB_TESTS) {
    await c.query('insert into lab_tests (code, kind, name_en, name_ar) values ($1,$2,$3,$4) on conflict do nothing', [t.code, t.kind, t.en, t.ar]);
  }
  for (const i of INTERACTIONS) {
    await c.query('insert into drug_interactions (ingredient_a, ingredient_b, severity, description_en, description_ar, source) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [...[i.a, i.b].sort(), i.severity, i.en, i.ar, 'seed-sample']);
  }
  const { rows } = await c.query('select count(*)::int as n from drugs');
  if (rows[0].n === 0) {
    for (const d of DRUGS) {
      await c.query(
        'insert into drugs (trade_name_en, trade_name_ar, active_ingredients, strength, form, manufacturer, price, source) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [d.en, d.ar, d.ingredients, d.strength, d.form, d.manufacturer, d.price, 'seed-sample'],
      );
    }
  }
}

export interface DemoIds {
  orgId: string;
  clinicIds: string[];
  doctorIds: string[];
  serviceIds: string[];
  staff: Record<string, string>;
}

/** Synthetic demo organisation for dev/staging (never production data). */
export async function seedDemo(c: Client, box: SecretBox, opts: { slug?: string; name?: string } = {}): Promise<DemoIds> {
  const slug = opts.slug ?? 'demo';
  const existing = await c.query('select id from organisations where slug = $1', [slug]);
  if (existing.rows[0]) throw new Error(`organisation ${slug} already seeded`);
  const org = (
    await c.query(
      `insert into organisations (name_ar, name_en, slug, settings) values ($1, $2, $3, $4) returning id`,
      [
        opts.name ?? 'شبكة هيلث فلو التجريبية',
        'HealthFlow Demo Network',
        slug,
        JSON.stringify({
          defaultLocale: 'ar',
          digitStyle: 'western',
          booking: { leadMinutes: 60, cancellationCutoffHours: 6, maxReschedules: 2, noShowFee: 0, depositPercent: 100, holdMinutes: 10, noShowAfterMinutes: 30, rescheduleFee: 0 },
          reminders: { hoursBefore: [24, 2] },
          discountApprovalPercent: 20,
          shiftVarianceThreshold: 1000,
          queueNotifyPositions: 3,
          mrnFormat: 'HF-{n:6}',
        }),
      ],
    )
  ).rows[0].id as string;
  const q = (sql: string, params: unknown[]) => c.query(sql, params).then((r) => r.rows[0]);
  await c.query(`insert into org_subscriptions (organisation_id, plan_code, status, current_period_end) values ($1, 'enterprise', 'active', current_date + 365) on conflict do nothing`, [org]);
  await c.query(`insert into platform_admins (keycloak_sub, email, name) values ($1, $2, 'Platform Admin') on conflict do nothing`, [`dev-platform-${slug}`, `platform@${slug}.healthflow.eg`]);

  const le = await q(
    `insert into legal_entities (organisation_id, name_ar, name_en, tax_registration_number, commercial_register, address)
     values ($1,'شركة هيلث فلو للخدمات الطبية','HealthFlow Medical Services','123-456-789','CR-55555','القاهرة') returning id`,
    [org],
  );
  const clinicsData = [
    { slug: 'nasr-city', ar: 'عيادات هيلث فلو - مدينة نصر', en: 'HealthFlow Clinics - Nasr City', gov: 'cairo', city: 'مدينة نصر', lat: 30.0561, lng: 31.3301 },
    { slug: 'dokki', ar: 'عيادات هيلث فلو - الدقي', en: 'HealthFlow Clinics - Dokki', gov: 'giza', city: 'الدقي', lat: 30.0385, lng: 31.2123 },
  ];
  const clinicIds: string[] = [];
  for (const [i, cl] of clinicsData.entries()) {
    const r = await q(
      `insert into clinics (organisation_id, legal_entity_id, name_ar, name_en, slug, governorate, city, address_lines, lat, lng, phones, working_hours, receipt_prefix)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [org, le.id, cl.ar, cl.en, cl.slug, cl.gov, cl.city, 'شارع ' + (i + 10), cl.lat, cl.lng, [`+20100000${1000 + i}`],
        JSON.stringify([6, 0, 1, 2, 3, 4].map((wd) => ({ weekday: wd, open: '10:00', close: '22:00' }))), i === 0 ? 'NC' : 'DK'],
    );
    clinicIds.push(r.id);
  }
  const spec = new Map((await c.query('select id, slug from specialties')).rows.map((r) => [r.slug, r.id]));
  for (const cid of clinicIds) {
    for (const s of ['internal-medicine', 'paediatrics', 'dermatology', 'physiotherapy']) {
      await c.query('insert into clinic_specialties (organisation_id, clinic_id, specialty_id) values ($1,$2,$3)', [org, cid, spec.get(s)]);
    }
  }

  const services = [
    { code: 'CONS-IM', ar: 'كشف باطنة', en: 'Internal medicine consultation', spec: 'internal-medicine', dur: 20, type: 'consultation', vat: 'exempt', price: 40000 },
    { code: 'CONS-PED', ar: 'كشف أطفال', en: 'Paediatrics consultation', spec: 'paediatrics', dur: 20, type: 'consultation', vat: 'exempt', price: 35000 },
    { code: 'CONS-DERM', ar: 'كشف جلدية', en: 'Dermatology consultation', spec: 'dermatology', dur: 15, type: 'consultation', vat: 'exempt', price: 45000 },
    { code: 'VIDEO-IM', ar: 'استشارة باطنة بالفيديو', en: 'Internal medicine video consultation', spec: 'internal-medicine', dur: 20, type: 'telemedicine', vat: 'exempt', price: 35000 },
    { code: 'FU', ar: 'استشارة متابعة', en: 'Follow-up', spec: null, dur: 10, type: 'follow_up', vat: 'exempt', price: 15000 },
    { code: 'PROC-LASER', ar: 'جلسة ليزر تجميلي', en: 'Cosmetic laser session', spec: 'dermatology', dur: 30, type: 'procedure', vat: 'taxable', price: 120000 },
    { code: 'PT-SESSION', ar: 'جلسة علاج طبيعي', en: 'Physiotherapy session', spec: 'physiotherapy', dur: 45, type: 'procedure', vat: 'exempt', price: 30000 },
  ];
  const serviceIds: string[] = [];
  const serviceByCode = new Map<string, string>();
  for (const s of services) {
    const r = await q(
      `insert into services (organisation_id, code, name_ar, name_en, specialty_id, duration_minutes, type, vat) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [org, s.code, s.ar, s.en, s.spec ? spec.get(s.spec) : null, s.dur, s.type, s.vat],
    );
    serviceIds.push(r.id);
    serviceByCode.set(s.code, r.id);
    for (const cid of clinicIds) {
      await c.query(`insert into price_list_items (organisation_id, clinic_id, service_id, price, effective_from) values ($1,$2,$3,$4,'2026-01-01')`, [org, cid, r.id, s.price]);
    }
  }
  await c.query(
    `insert into packages (organisation_id, service_id, name_ar, name_en, sessions, validity_days, price) values ($1,$2,'باقة ١٠ جلسات علاج طبيعي','Physiotherapy 10-session package',10,90,250000)`,
    [org, serviceByCode.get('PT-SESSION')],
  );

  const staff: Record<string, string> = {};
  const mkUser = async (key: string, ar: string, en: string, email: string, roles: { role: string; clinic: string | null }[]) => {
    const u = await q(`insert into users (organisation_id, email, name_ar, name_en, status, mfa_enrolled, keycloak_sub) values ($1,$2,$3,$4,'active',true,$5) returning id`, [org, email, ar, en, `dev-${slug}-${key}`]);
    for (const r of roles) await c.query('insert into staff_memberships (organisation_id, user_id, clinic_id, role) values ($1,$2,$3,$4)', [org, u.id, r.clinic, r.role]);
    staff[key] = u.id;
    return u.id as string;
  };
  await mkUser('owner', 'مالك الشبكة', 'Network Owner', 'owner@' + slug + '.healthflow.eg', [{ role: 'owner', clinic: null }]);
  await mkUser('director', 'مدير الشبكة', 'Network Director', 'director@' + slug + '.healthflow.eg', [{ role: 'network_director', clinic: null }]);
  await mkUser('manager', 'مدير عيادة مدينة نصر', 'Nasr City Manager', 'manager@' + slug + '.healthflow.eg', [{ role: 'clinic_manager', clinic: clinicIds[0]! }]);
  await mkUser('reception', 'موظفة الاستقبال', 'Receptionist', 'reception@' + slug + '.healthflow.eg', [{ role: 'receptionist', clinic: clinicIds[0]! }]);
  await mkUser('reception2', 'استقبال الدقي', 'Dokki Receptionist', 'reception2@' + slug + '.healthflow.eg', [{ role: 'receptionist', clinic: clinicIds[1]! }]);
  await mkUser('nurse', 'الممرضة', 'Nurse', 'nurse@' + slug + '.healthflow.eg', [{ role: 'nurse', clinic: clinicIds[0]! }]);
  await mkUser('accountant', 'المحاسب', 'Accountant', 'accountant@' + slug + '.healthflow.eg', [{ role: 'accountant', clinic: null }]);

  const doctors = [
    { key: 'dr_ahmed', ar: 'د. أحمد سامي', en: 'Dr. Ahmed Samy', slug: 'ahmed-samy', spec: 'internal-medicine', title: 'consultant', gender: 'male', svc: ['CONS-IM', 'VIDEO-IM', 'FU'], clinics: [0, 1] },
    { key: 'dr_mona', ar: 'د. منى خالد', en: 'Dr. Mona Khaled', slug: 'mona-khaled', spec: 'paediatrics', title: 'specialist', gender: 'female', svc: ['CONS-PED', 'FU'], clinics: [0] },
    { key: 'dr_sara', ar: 'د. سارة عادل', en: 'Dr. Sara Adel', slug: 'sara-adel', spec: 'dermatology', title: 'dr', gender: 'female', svc: ['CONS-DERM', 'PROC-LASER', 'FU'], clinics: [1] },
  ];
  const doctorIds: string[] = [];
  for (const [i, d] of doctors.entries()) {
    const id = await mkUser(d.key, d.ar, d.en, `${d.slug}@${slug}.healthflow.eg`, d.clinics.map((ci) => ({ role: 'doctor', clinic: clinicIds[ci]! })));
    doctorIds.push(id);
    await c.query(
      `insert into doctor_profiles (user_id, organisation_id, slug, title, syndicate_number, gender, languages, bio_ar, bio_en, qualifications)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, org, d.slug, d.title, String(100200 + i), d.gender, ['ar', 'en'], `${d.ar} خبرة أكثر من ١٠ سنوات.`, `${d.en}, over 10 years of experience.`, JSON.stringify([{ degree: 'MBBCh', institution: 'Cairo University', year: 2010 }])],
    );
    await c.query('insert into doctor_specialties (organisation_id, doctor_id, specialty_id) values ($1,$2,$3)', [org, id, spec.get(d.spec)]);
    for (const code of d.svc) await c.query('insert into doctor_services (organisation_id, doctor_id, service_id) values ($1,$2,$3)', [org, id, serviceByCode.get(code)]);
    for (const ci of d.clinics) {
      await c.query(
        `insert into doctor_sessions (organisation_id, clinic_id, doctor_id, weekdays, start_time, end_time, slot_minutes, capacity_per_slot, walk_in_reserved, breaks, effective_from)
         values ($1,$2,$3,$4,$5,$6,20,1,2,'[]','2026-01-01')`,
        [org, clinicIds[ci], id, ci === 0 ? [6, 1, 3] : [0, 2, 4], '17:00', '21:00'],
      );
    }
    await c.query(`insert into commission_rules (organisation_id, doctor_id, rule) values ($1,$2,$3)`, [org, id, JSON.stringify({ kind: 'percent', percent: 50 })]);
  }

  for (const t of ENCOUNTER_TEMPLATES) {
    await c.query(
      'insert into encounter_templates (organisation_id, specialty_id, name_ar, name_en, sections, common_diagnoses) values ($1,$2,$3,$4,$5,$6)',
      [org, spec.get(t.specialty), t.ar, t.en, JSON.stringify(t.sections), t.diagnoses],
    );
  }
  for (const type of ['health_data', 'messaging', 'marketing', 'telemedicine', 'itqan_sharing']) {
    await c.query(
      `insert into consent_versions (organisation_id, type, version, text_ar, text_en) values ($1,$2,1,$3,$4)`,
      [org, type, `نص الموافقة (${type}) - مسودة تنتظر مراجعة المستشار القانوني.`, `Consent text (${type}) - draft pending counsel review.`],
    );
  }
  for (const event of MESSAGE_EVENTS) {
    for (const locale of ['ar', 'en'] as const) {
      const body = catalogs[locale][`msg.${event}`];
      if (!body) continue;
      for (const channel of ['sms', 'whatsapp', 'push']) {
        await c.query('insert into message_templates (organisation_id, event, channel, locale, body) values ($1,$2,$3,$4,$5)', [org, event, channel, locale, body]);
      }
    }
  }
  await c.query(
    `insert into articles (organisation_id, slug, title_ar, title_en, body_ar, body_en, status, published_at) values
     ($1,'ramadan-diabetes','الصيام ومرضى السكري','Fasting and diabetes','نصائح لمرضى السكري خلال شهر رمضان.','Advice for people with diabetes during Ramadan.','published',now())`,
    [org],
  );
  void box;
  return { orgId: org, clinicIds, doctorIds, serviceIds, staff };
}
