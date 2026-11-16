'use client';

import { useMemo } from 'react';
import { qs } from './api';
import { useApi } from './hooks';
import type { PriceRow, ServiceRow, SessionRow } from './types';

/**
 * Doctors working at a clinic. Derived from the clinic's sessions (schedule:view) because receptionists and
 * nurses do not hold staff:view, which `GET /v1/doctors` requires.
 */
export function useClinicDoctors(clinicId: string) {
  const sessions = useApi<SessionRow[]>(clinicId ? `/sessions${qs({ clinicId })}` : null);
  const doctors = useMemo(() => {
    const m = new Map<string, { id: string; name: string; serviceIds: Set<string> }>();
    for (const s of sessions.data ?? []) {
      const d = m.get(s.doctor_id) ?? { id: s.doctor_id, name: s.doctor_name, serviceIds: new Set<string>() };
      for (const id of s.service_ids ?? []) d.serviceIds.add(id);
      m.set(s.doctor_id, d);
    }
    return [...m.values()];
  }, [sessions.data]);
  return { doctors, sessions: sessions.data ?? [], loading: sessions.loading, error: sessions.error };
}

export function useServices() {
  const r = useApi<ServiceRow[]>('/services');
  const active = useMemo(() => (r.data ?? []).filter((s) => s.is_active), [r.data]);
  return { services: r.data ?? [], active, loading: r.loading, error: r.error, reload: r.reload };
}

/** Effective clinic price for a service today (doctor override first). Display only; the API prices bills. */
export function usePrices(clinicId: string) {
  const r = useApi<PriceRow[]>(clinicId ? `/prices${qs({ clinicId })}` : null);
  const today = new Date().toISOString().slice(0, 10);
  const priceOf = (serviceId: string, doctorId?: string | null): number | null => {
    const rows = (r.data ?? []).filter((p) => p.service_id === serviceId && String(p.effective_from).slice(0, 10) <= today && (!p.effective_to || String(p.effective_to).slice(0, 10) >= today));
    const own = doctorId ? rows.find((p) => p.doctor_id === doctorId) : undefined;
    const base = rows.find((p) => !p.doctor_id);
    return (own ?? base)?.price ?? null;
  };
  return { prices: r.data ?? [], priceOf, reload: r.reload };
}
