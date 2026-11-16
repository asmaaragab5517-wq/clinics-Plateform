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
