import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, OfflineError, loadSessions, onSessionExpired, setPatientTokens, setStaffTokens, getStaffTokens, type PatientTokens } from './api';
import { clearPatientCache } from './cache';
import { authApi } from './endpoints';
import { logoutKeycloak, type StaffTokens } from './oidc';
import { KEYS, deleteSecret, getSecret, setSecret } from './storage';
import type { StaffMe } from './types';

/**
 * Sessions and role-based modes (D4: one app). A device can hold a patient session (OTP) and a staff session
 * (Keycloak) at the same time; the mode switcher picks which one drives the UI.
 *   patient   ← patient session
 *   doctor    ← staff role "doctor"
 *   reception ← staff roles receptionist / nurse / clinic_manager / owner (queue:create privilege)
 */
export type Mode = 'patient' | 'doctor' | 'reception';

interface SessionValue {
  ready: boolean;
  hasPatient: boolean;
  staff: StaffMe | null;
  staffSignedIn: boolean;
  staffError: unknown;
  mode: Mode | null;
  modes: Mode[];
  clinicId: string | null;
  clinics: StaffMe['clinics'];
  setMode: (m: Mode) => Promise<void>;
  setClinic: (id: string) => Promise<void>;
  signInPatient: (t: PatientTokens) => Promise<void>;
  signInStaff: (t: StaffTokens) => Promise<StaffMe>;
  reloadStaff: () => Promise<void>;
  signOutPatient: (opts?: { remote?: boolean }) => Promise<void>;
  signOutStaff: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function modesFor(hasPatient: boolean, me: StaffMe | null): Mode[] {
  const out: Mode[] = [];
  if (hasPatient) out.push('patient');
  if (me?.roles.includes('doctor')) out.push('doctor');
  if (me && (me.privileges.includes('queue:create') || me.roles.some((r) => r === 'receptionist' || r === 'nurse' || r === 'clinic_manager'))) out.push('reception');
  return out;
}

/** Clinics a staff member works in: memberships with a clinic, or all clinics for network roles. */
function clinicsFor(me: StaffMe | null): StaffMe['clinics'] {
  if (!me) return [];
  if (me.network) return me.clinics;
  const ids = new Set(me.memberships.map((m) => m.clinicId).filter(Boolean));
  return me.clinics.filter((c) => ids.has(c.id));
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [hasPatient, setHasPatient] = useState(false);
  const [staffSignedIn, setStaffSignedIn] = useState(false);
  const [staff, setStaff] = useState<StaffMe | null>(null);
  const [staffError, setStaffError] = useState<unknown>(null);
  const [mode, setModeState] = useState<Mode | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);

  const fetchMe = useCallback(async () => {
    try {
      const me = await authApi.staffMe();
      setStaff(me);
      setStaffError(null);
      return me;
    } catch (e) {
      setStaffError(e);
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await setStaffTokens(null);
        setStaffSignedIn(false);
        setStaff(null);
      }
      if (!(e instanceof OfflineError)) throw e;
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await loadSessions();
      setHasPatient(s.patient);
      setStaffSignedIn(s.staff);
      const [m, c] = await Promise.all([getSecret(KEYS.mode), getSecret(KEYS.clinic)]);
      setModeState(m === 'patient' || m === 'doctor' || m === 'reception' ? m : null);
      setClinicId(c);
      if (s.staff) await fetchMe().catch(() => undefined);
      setReady(true);
    })();
  }, [fetchMe]);

  useEffect(
    () =>
      onSessionExpired((kind) => {
        if (kind === 'patient') {
          setHasPatient(false);
          void clearPatientCache();
        } else {
          setStaffSignedIn(false);
          setStaff(null);
        }
      }),
    [],
  );

  const clinics = useMemo(() => clinicsFor(staff), [staff]);
  useEffect(() => {
    // Keep a valid clinic selected for staff modes.
    if (clinics.length && (!clinicId || !clinics.some((c) => c.id === clinicId))) {
      setClinicId(clinics[0]!.id);
      void setSecret(KEYS.clinic, clinics[0]!.id);
    }
  }, [clinics, clinicId]);

  const modes = useMemo(() => modesFor(hasPatient, staff), [hasPatient, staff]);

  const setMode = useCallback(async (m: Mode) => {
    setModeState(m);
    await setSecret(KEYS.mode, m);
  }, []);
  const setClinic = useCallback(async (id: string) => {
    setClinicId(id);
    await setSecret(KEYS.clinic, id);
  }, []);

  const signInPatient = useCallback(
    async (t: PatientTokens) => {
      await setPatientTokens(t);
      setHasPatient(true);
      await setMode('patient');
    },
    [setMode],
  );

  const signInStaff = useCallback(
    async (t: StaffTokens) => {
      await setStaffTokens(t);
      setStaffSignedIn(true);
      const me = await fetchMe();
      if (!me) throw new OfflineError();
      const m = modesFor(hasPatient, me).find((x) => x !== 'patient');
      if (m) await setMode(m);
      return me;
    },
    [fetchMe, hasPatient, setMode],
  );

  const signOutPatient = useCallback(async (opts: { remote?: boolean } = {}) => {
    if (opts.remote !== false) await authApi.logout().catch(() => undefined);
    await setPatientTokens(null);
    await clearPatientCache();
    await deleteSecret(KEYS.pushToken);
    setHasPatient(false);
  }, []);

  const signOutStaff = useCallback(async () => {
    const t = getStaffTokens();
    if (t) await logoutKeycloak(t);
    await setStaffTokens(null);
    setStaffSignedIn(false);
    setStaff(null);
  }, []);

  const reloadStaff = useCallback(async () => {
    await fetchMe().catch(() => undefined);
  }, [fetchMe]);

  const value: SessionValue = {
    ready,
    hasPatient,
    staff,
    staffSignedIn,
    staffError,
    mode: mode && modes.includes(mode) ? mode : null,
    modes,
    clinicId,
    clinics,
    setMode,
    setClinic,
    signInPatient,
    signInStaff,
    reloadStaff,
    signOutPatient,
    signOutStaff,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
