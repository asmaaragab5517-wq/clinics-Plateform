import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SecretBox, Tx } from '@hf/db';
import { ageInYears, decodeNationalId, nameSimilarity, normaliseArabic, type PatientInput } from '@hf/shared';
import { BOX } from '../common/services';
import { DomainError, badRequest } from '../common/errors';
import type { Principal } from '../common/principal';

/** Tables whose rows follow a patient through merge/un-merge. */
const PATIENT_TABLES = [
  'patient_contacts', 'patient_links', 'appointments', 'queue_tickets', 'waitlist', 'follow_ups', 'encounters', 'addenda', 'medical_history_items',
  'orders', 'documents', 'prescriptions', 'bills', 'credit_notes', 'payments', 'refunds', 'package_balances', 'package_consumptions', 'payment_intents',
  'messages', 'consents', 'data_requests', 'reviews',
];

export interface DuplicateCandidate {
  id: string;
  mrn: string;
  name: string;
  date_of_birth: string;
  reason: 'national_id' | 'phone' | 'name_dob';
  score: number;
}

@Injectable()
export class PatientsService {
  constructor(@Inject(BOX) private readonly box: SecretBox) {}

  fullName(p: { first_name_ar: string; father_name_ar: string; grandfather_name_ar?: string; family_name_ar: string }) {
    return [p.first_name_ar, p.father_name_ar, p.grandfather_name_ar, p.family_name_ar].filter(Boolean).join(' ');
  }

  nidIndex(orgId: string, nid: string) {
    return this.box.blindIndex(nid, orgId);
  }

  /** FR-PAT-5: National ID exact, phone exact, fuzzy Arabic name + DOB. */
  async findDuplicates(tx: Tx, orgId: string, input: Pick<PatientInput, 'nationalId' | 'phones' | 'nameAr' | 'dateOfBirth'>, excludeId?: string): Promise<DuplicateCandidate[]> {
    const out = new Map<string, DuplicateCandidate>();
    const add = (r: { id: string; mrn: string; first_name_ar: string; father_name_ar: string; family_name_ar: string; date_of_birth: string }, reason: DuplicateCandidate['reason'], score: number) => {
      if (r.id === excludeId || (out.get(r.id)?.score ?? 0) >= score) return;
      out.set(r.id, { id: r.id, mrn: r.mrn, name: this.fullName(r), date_of_birth: r.date_of_birth, reason, score });
    };
    const cols = 'p.id, p.mrn, p.first_name_ar, p.father_name_ar, p.family_name_ar, p.date_of_birth';
    if (input.nationalId) {
      for (const r of await tx.query(`select ${cols} from patients p where national_id_bidx = $1 and merged_into_id is null`, [this.nidIndex(orgId, input.nationalId)])) add(r as never, 'national_id', 1);
    }
    const phones = (input.phones ?? []).map((p) => p.number);
    if (phones.length) {
      for (const r of await tx.query(`select ${cols} from patients p join patient_contacts c on c.patient_id = p.id where c.phone = any($1) and p.merged_into_id is null`, [phones])) add(r as never, 'phone', 0.8);
    }
    const name = normaliseArabic([input.nameAr.first, input.nameAr.father, input.nameAr.grandfather, input.nameAr.family].filter(Boolean).join(' '));
    const candidates = await tx.query<{ id: string; mrn: string; first_name_ar: string; father_name_ar: string; grandfather_name_ar: string; family_name_ar: string; date_of_birth: string }>(
      `select p.*, p.date_of_birth from patients p where date_of_birth = $1 and merged_into_id is null and similarity(name_search, $2) > 0.3 limit 20`,
      [input.dateOfBirth, name],
    );
    for (const c of candidates) {
      const sim = nameSimilarity(this.fullName(c), name);
      if (sim >= 0.8) add(c, 'name_dob', Math.min(0.79, sim * 0.9));
    }
    return [...out.values()].sort((a, b) => b.score - a.score);
  }

  async create(tx: Tx, actor: Principal, input: PatientInput, opts: { force?: boolean; allowMinorWithoutGuardian?: boolean } = {}) {
    const orgId = tx.ctx.orgId;
    if (!opts.force) {
      const dups = await this.findDuplicates(tx, orgId, input);
      if (dups.length) throw new DomainError('possible_duplicate', HttpStatus.CONFLICT, dups);
    }
    if (ageInYears(input.dateOfBirth) < 18 && !input.guardianPatientId && !opts.allowMinorWithoutGuardian) throw badRequest('guardian_required_for_minor');
    const org = await tx.one<{ settings: { mrnFormat?: string } }>('select settings from organisations where id = app_org()');
    const n = await tx.one<{ n: number }>(`select next_number('mrn') as n`);
    const mrn = (org.settings.mrnFormat ?? 'HF-{n:6}').replace(/\{n:(\d)\}/, (_, w: string) => String(n.n).padStart(Number(w), '0'));
    const nid = input.nationalId ? decodeNationalId(input.nationalId) : null;
    const nameSearch = `${normaliseArabic(this.fullName({ first_name_ar: input.nameAr.first, father_name_ar: input.nameAr.father, grandfather_name_ar: input.nameAr.grandfather, family_name_ar: input.nameAr.family }))} ${(input.nameEn ?? '').toLowerCase()}`.trim();
    const actorId = actor.kind === 'staff' ? actor.userId : null;
    const p = await tx.one<{ id: string; mrn: string }>(
      `insert into patients (organisation_id, mrn, first_name_ar, father_name_ar, grandfather_name_ar, family_name_ar, name_en, name_search, national_id_enc, national_id_bidx,
         passport_enc, passport_bidx, nationality, date_of_birth, gender, email, governorate, city, address, marital_status, occupation, emergency_contact, guardian_patient_id, custom_fields, created_by)
       values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) returning id, mrn`,
      [
        mrn, input.nameAr.first, input.nameAr.father, input.nameAr.grandfather, input.nameAr.family, input.nameEn ?? null, nameSearch,
        nid?.ok ? this.box.encrypt(nid.info.nationalId, `nid:${orgId}`) : null, nid?.ok ? this.nidIndex(orgId, nid.info.nationalId) : null,
        input.passport ? this.box.encrypt(input.passport.number, `passport:${orgId}`) : null, input.passport ? this.box.blindIndex(input.passport.number.toUpperCase(), orgId) : null,
        input.passport?.nationality ?? 'EG', input.dateOfBirth, input.gender, input.email ?? null, input.governorate ?? null, input.city ?? null, input.address ?? null,
        input.maritalStatus ?? null, input.occupation ?? null, input.emergencyContact ? JSON.stringify(input.emergencyContact) : null, input.guardianPatientId ?? null,
        JSON.stringify(input.customFields ?? {}), actorId,
      ],
    );
    const primaryIdx = Math.max(0, input.phones.findIndex((ph) => ph.primary));
    for (const [i, ph] of input.phones.entries()) {
      await tx.query('insert into patient_contacts (organisation_id, patient_id, phone, is_primary) values (app_org(), $1, $2, $3)', [p.id, ph.number, i === primaryIdx]);
    }
    return p;
  }

  decryptNid(orgId: string, enc: Buffer | null): string | null {
    return enc ? this.box.decrypt(enc, `nid:${orgId}`) : null;
  }

  /** Move every patient-owned row from source to target, recording ids for un-merge. */
  async merge(tx: Tx, sourceId: string, targetId: string, userId: string, reason: string) {
    if (sourceId === targetId) throw badRequest('same_patient');
    const moved: Record<string, string[]> = {};
    await tx.query(
      `delete from patient_links s where s.patient_id = $1 and exists (select 1 from patient_links t where t.patient_id = $2 and t.account_id = s.account_id)`,
      [sourceId, targetId],
    );
    for (const t of PATIENT_TABLES) {
      const rows = await tx.query<{ id: string | null }>(`update ${t} set patient_id = $2 where patient_id = $1 returning id`, [sourceId, targetId]);
      if (rows.length) moved[t] = rows.map((r) => r.id!).filter(Boolean);
    }
    await tx.query('update patients set merged_into_id = $2, merged_at = now() where id = $1', [sourceId, targetId]);
    return tx.one<{ id: string }>(
      'insert into patient_merges (organisation_id, source_patient_id, target_patient_id, moved, reason, merged_by) values (app_org(), $1,$2,$3,$4,$5) returning *',
      [sourceId, targetId, JSON.stringify(moved), reason, userId],
    );
  }

  async unmerge(tx: Tx, mergeId: string, userId: string) {
    const m = await tx.maybeOne<{ id: string; source_patient_id: string; target_patient_id: string; moved: Record<string, string[]>; merged_at: Date; unmerged_at: Date | null }>(
      'select * from patient_merges where id = $1 for update',
      [mergeId],
    );
    if (!m || m.unmerged_at) throw badRequest('merge_not_found');
    if (Date.now() - new Date(m.merged_at).getTime() > 30 * 86400_000) throw new DomainError('unmerge_window_expired', HttpStatus.CONFLICT);
    for (const [t, ids] of Object.entries(m.moved)) {
      if (!PATIENT_TABLES.includes(t)) continue;
      await tx.query(`update ${t} set patient_id = $1 where id = any($2::uuid[]) and patient_id = $3`, [m.source_patient_id, ids, m.target_patient_id]);
    }
    await tx.query('update patients set merged_into_id = null, merged_at = null where id = $1', [m.source_patient_id]);
    await tx.query('update patient_merges set unmerged_at = now(), unmerged_by = $2 where id = $1', [mergeId, userId]);
    return { ok: true };
  }

  /** EMR access: privilege, or an unexpired break-glass grant (IAM-5). */
  async canViewEmr(tx: Tx, p: Principal, patientId: string): Promise<boolean> {
    if (p.kind === 'patient') return p.patientIds.includes(patientId);
    if (p.kind !== 'staff') return false;
    if (p.privileges.has('emr:view')) return true;
    return !!(await tx.maybeOne('select 1 from access_grants where user_id = $1 and patient_id = $2 and expires_at > now()', [p.userId, patientId]));
  }

  async hasHealthConsent(tx: Tx, patientId: string): Promise<boolean> {
    const c = await tx.maybeOne<{ granted: boolean }>(`select granted from consents where patient_id = $1 and type = 'health_data' order by created_at desc limit 1`, [patientId]);
    return !!c?.granted;
  }
}
