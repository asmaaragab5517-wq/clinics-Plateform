import { KEYS, deleteJson, getJson, setJson } from './storage';
import type { PortalAppointment, PortalPrescription } from './types';

/**
 * FR-APP-6 offline cache: upcoming appointments and the most recent prescription(s), read-only.
 * Stored in SecureStore (encrypted, this-device-only) in chunks; lists are trimmed to keep items small.
 */
const MAX_APPTS = 10;
const MAX_RX = 3;

export interface Cached<T> {
  savedAt: string;
  items: T[];
}

export async function cacheUpcoming(items: PortalAppointment[]) {
  const trimmed = items.slice(0, MAX_APPTS).map((a) => ({ ...a, checkout_url: null }));
  await setJson(KEYS.cacheUpcoming, { savedAt: new Date().toISOString(), items: trimmed } satisfies Cached<PortalAppointment>);
}
export const readUpcoming = () => getJson<Cached<PortalAppointment>>(KEYS.cacheUpcoming);

export async function cachePrescriptions(items: PortalPrescription[]) {
  // The list is newest first (issued_at desc); keep the last few so "the last prescription" is always there.
  let keep = items.slice(0, MAX_RX);
  while (keep.length > 1 && !(await setJson(KEYS.cachePrescriptions, { savedAt: new Date().toISOString(), items: keep }))) keep = keep.slice(0, -1);
  if (keep.length === 1) await setJson(KEYS.cachePrescriptions, { savedAt: new Date().toISOString(), items: keep });
}
export const readPrescriptions = () => getJson<Cached<PortalPrescription>>(KEYS.cachePrescriptions);

export async function clearPatientCache() {
  await Promise.all([deleteJson(KEYS.cacheUpcoming), deleteJson(KEYS.cachePrescriptions)]);
}
