import { get } from './api';
import type { EncounterListRow } from './types';

/**
 * The API has no "encounter for appointment" lookup and the queue/appointment rows carry no encounter id,
 * so we pick the most recent open encounter of the patient with this doctor (created at check-in, FR-EMR-1).
 */
export async function findOpenEncounter(patientId: string, doctorId?: string): Promise<EncounterListRow | null> {
  const rows = await get<EncounterListRow[]>(`/patients/${patientId}/encounters`);
  const open = rows.filter((e) => e.status === 'open' && (!doctorId || e.doctor_id === doctorId));
  return open[0] ?? null;
}

/** Encounter editor sections (FR-EMR-3 templates choose a subset). `dentalChart` is opt-in, for dentistry visits. */
export const ENCOUNTER_SECTIONS = ['vitals', 'chiefComplaint', 'hpi', 'examination', 'diagnoses', 'problems', 'observations', 'notes', 'bodyChart', 'orders', 'prescriptions', 'followUp'] as const;
export const TEMPLATE_SECTIONS = [...ENCOUNTER_SECTIONS, 'dentalChart'] as const;
/** Free-text fields a template can pre-fill (applied only to empty fields). */
export const TEMPLATE_DEFAULT_FIELDS = ['chiefComplaint', 'hpi', 'examination', 'notes'] as const;

export interface EncounterTemplate {
  id: string;
  specialty_id: string | null;
  specialty_slug: string | null;
  doctor_id: string | null;
  name_ar: string;
  name_en: string;
  sections: string[];
  defaults: Record<string, string>;
  common_diagnoses: string[];
  created_at: string;
}
