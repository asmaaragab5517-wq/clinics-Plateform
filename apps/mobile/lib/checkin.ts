import { staffApi } from './endpoints';
import { todayRange } from './today';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Interpret a booking QR. Accepted payloads (the QR format is not specified by the API — README "API gaps"):
 * an appointment UUID, a booking ref, `healthflow://checkin/<id|ref>`, or an https link containing
 * `/appointments/<uuid>` or `?ref=<ref>`.
 */
export function parseBookingQr(raw: string): { appointmentId?: string; ref?: string } | null {
  const v = raw.trim();
  if (!v || v.length > 500) return null;
  const ref = /[?&]ref=([A-Za-z0-9-]+)/.exec(v)?.[1];
  if (ref) return { ref };
  const id = UUID.exec(v)?.[0];
  if (id) return { appointmentId: id.toLowerCase() };
  const tail = v.replace(/^healthflow:\/\/checkin\//i, '');
  if (/^[A-Za-z0-9-]{4,40}$/.test(tail)) return { ref: tail.toUpperCase() };
  return null;
}

/**
 * Resolve a booking ref with GET /v1/appointments?ref= (today, Africa/Cairo). Not limited to the selected clinic so
 * a booking for another branch can be reported as such instead of "not found".
 */
export async function resolveRef(clinicId: string, ref: string): Promise<{ id: string } | { otherClinic: true } | null> {
  const r = todayRange();
  const list = await staffApi.appointments({ ref: ref.toUpperCase().slice(0, 20), from: r.from, to: r.to });
  const here = list.find((a) => a.clinic_id === clinicId);
  if (here) return { id: here.id };
  return list.length ? { otherClinic: true } : null;
}
