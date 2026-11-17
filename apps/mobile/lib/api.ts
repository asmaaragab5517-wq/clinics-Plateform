import { Platform } from 'react-native';
import { API_URL, ORG_SLUG } from './config';
import { setOnline, setProbe } from './net';
import { refreshKeycloak, type StaffTokens } from './oidc';
import { randomId } from './random';
import { KEYS, deleteSecret, getSecret, setSecret } from './storage';

/**
 * HealthFlow API client (apps/api, /v1).
 * - x-org header (organisation slug) on every call; x-client: app so bookings are recorded with channel "app".
 * - Bearer tokens live only in expo-secure-store (Keychain/Keystore) and in memory (FR-APP-4).
 * - 401 → one transparent refresh (single-flight per session kind) → one retry. Patient refresh tokens rotate
 *   on every use (POST /v1/auth/refresh), so the new pair is persisted before the retry.
 * - SEC-11: nothing here logs. Errors carry only the API error code, never bodies, tokens, OTPs or PHI.
 */
export type AuthKind = 'none' | 'patient' | 'staff';

export interface PatientTokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** Thrown when the request never reached the server (no network, DNS, TLS/pinning failure, timeout). */
export class OfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'OfflineError';
  }
}

let patient: PatientTokens | null = null;
let staff: StaffTokens | null = null;
const refreshing: { patient: Promise<boolean> | null; staff: Promise<boolean> | null } = { patient: null, staff: null };
type ExpiredListener = (kind: 'patient' | 'staff') => void;
const expiredListeners = new Set<ExpiredListener>();

export function onSessionExpired(l: ExpiredListener) {
  expiredListeners.add(l);
  return () => {
    expiredListeners.delete(l);
  };
}

export async function loadSessions(): Promise<{ patient: boolean; staff: boolean }> {
  const [p, s] = await Promise.all([getSecret(KEYS.patientSession), getSecret(KEYS.staffSession)]);
  try {
    patient = p ? (JSON.parse(p) as PatientTokens) : null;
  } catch {
    patient = null;
  }
  try {
    staff = s ? (JSON.parse(s) as StaffTokens) : null;
  } catch {
    staff = null;
  }
  return { patient: !!patient, staff: !!staff };
}

export async function setPatientTokens(t: PatientTokens | null) {
  patient = t;
  if (t) await setSecret(KEYS.patientSession, JSON.stringify(t));
  else await deleteSecret(KEYS.patientSession);
}

export async function setStaffTokens(t: StaffTokens | null) {
  staff = t;
  if (t) await setSecret(KEYS.staffSession, JSON.stringify(t));
  else await deleteSecret(KEYS.staffSession);
}

export const getStaffTokens = () => staff;
/** This device's patient refresh token (sent to POST /v1/auth/logout so only this device is signed out). */
export const getPatientRefreshToken = () => patient?.refreshToken ?? null;
export const hasPatientSession = () => !!patient;
export const hasStaffSession = () => !!staff;

/** Stable per-install id sent with OTP verify so refresh-token families are per device. */
export async function deviceId(): Promise<string> {
  let id = await getSecret(KEYS.deviceId);
  if (!id) {
    id = randomId();
    await setSecret(KEYS.deviceId, id);
  }
  return id;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  auth?: AuthKind;
  /** Idempotency-Key header (bookings). Reuse the same key when retrying the same user action. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

function buildUrl(path: string, query?: Query) {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${API_URL}${path}${qs ? `?${qs}` : ''}`;
}

async function rawFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    setOnline(true);
    return res;
  } catch {
    setOnline(false);
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(kind: 'patient' | 'staff'): Promise<boolean> {
  const pending = refreshing[kind];
  if (pending) return pending;
  const run = (async () => {
    try {
      if (kind === 'patient') {
        if (!patient) return false;
        const res = await rawFetch(
          buildUrl('/v1/auth/refresh'),
          { method: 'POST', headers: baseHeaders(), body: JSON.stringify({ refreshToken: patient.refreshToken }) },
          15000,
        );
        if (!res.ok) {
          // invalid / expired / reused (family revoked): the session is over.
          await setPatientTokens(null);
          return false;
        }
        const j = (await res.json()) as PatientTokens;
        await setPatientTokens({ accessToken: j.accessToken, refreshToken: j.refreshToken });
        return true;
      }
      if (!staff?.refreshToken || staff.source !== 'keycloak') {
        await setStaffTokens(null);
        return false;
      }
      const next = await refreshKeycloak(staff.refreshToken);
      if (!next) {
        await setStaffTokens(null);
        return false;
      }
      await setStaffTokens(next);
      return true;
    } catch {
      // Network failure during refresh: keep the session, report offline.
      throw new OfflineError();
    }
  })();
  refreshing[kind] = run;
  try {
    const ok = await run;
    if (!ok) expiredListeners.forEach((l) => l(kind));
    return ok;
  } finally {
    refreshing[kind] = null;
  }
}

function baseHeaders(): Record<string, string> {
  return { accept: 'application/json', 'content-type': 'application/json', 'x-org': ORG_SLUG, 'x-client': 'app' };
}

function authHeader(kind: AuthKind): Record<string, string> {
  if (kind === 'patient' && patient) return { authorization: `Bearer ${patient.accessToken}` };
  if (kind === 'staff' && staff) return { authorization: `Bearer ${staff.accessToken}` };
  return {};
}

/** 401 codes that mean "do something else", not "token expired". */
const NO_REFRESH = new Set(['reauthentication_required', 'otp_invalid', 'otp_expired', 'otp_attempts_exceeded', 'pin_invalid']);

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const auth = opts.auth ?? 'none';
  const url = buildUrl(path, opts.query);
  const send = () =>
    rawFetch(
      url,
      {
        method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
        headers: { ...baseHeaders(), ...authHeader(auth), ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      },
      opts.timeoutMs ?? 20000,
    );
  let res = await send();
  if (res.status === 401 && auth !== 'none') {
    const code = await peekCode(res.clone());
    if (!NO_REFRESH.has(code) && (await refresh(auth))) res = await send();
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new ApiError(res.status, typeof j.error === 'string' ? j.error : `http_${res.status}`, j.details);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? await res.json() : await res.text()) as T;
}

async function peekCode(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? '';
  } catch {
    return '';
  }
}

setProbe(async () => {
  try {
    const r = await fetch(`${API_URL}/health`);
    return r.ok;
  } catch {
    return false;
  }
});

export const api = {
  get: <T>(path: string, query?: Query, auth: AuthKind = 'none') => request<T>(path, { query, auth }),
  post: <T>(path: string, body: unknown, auth: AuthKind = 'none', extra: Partial<RequestOptions> = {}) => request<T>(path, { method: 'POST', body: body ?? {}, auth, ...extra }),
  patch: <T>(path: string, body: unknown, auth: AuthKind = 'none') => request<T>(path, { method: 'PATCH', body, auth }),
};

export const platformName = (): 'ios' | 'android' | 'web' => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web');

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}
