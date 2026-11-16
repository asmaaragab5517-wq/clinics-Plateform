import { ApiError, api, newKey } from './api';

/**
 * NFR-7: queue and check-in actions taken while offline are kept for up to 5 minutes and replayed in order when the
 * connection returns. Each action carries an idempotency key so a replay after a lost response is safe; conflicts
 * (the world moved on while we were offline) are reported instead of silently dropped.
 */
export const OFFLINE_MAX_AGE_MS = 5 * 60_000;
const STORAGE_KEY = 'hf_offline_queue';

export interface QueuedAction {
  key: string;
  method: 'POST' | 'PATCH' | 'PUT';
  path: string;
  body: unknown;
  label: string;
  at: number;
}

export interface SyncNotice {
  id: string;
  label: string;
  kind: 'synced' | 'conflict' | 'expired';
  code?: string;
}

interface State {
  pending: QueuedAction[];
  notices: SyncNotice[];
  replaying: boolean;
}

let state: State = { pending: [], notices: [], replaying: false };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as QueuedAction[]) : [];
    state = { ...state, pending: Array.isArray(list) ? list : [] };
  } catch {
    state = { ...state, pending: [] };
  }
}

function set(next: Partial<State>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pending));
  } catch {
    /* storage full or blocked */
  }
  for (const l of listeners) l();
}

export function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getSnapshot(): State {
  load();
  return state;
}

const SERVER_SNAPSHOT: State = { pending: [], notices: [], replaying: false };
export function getServerSnapshot(): State {
  return SERVER_SNAPSHOT;
}

export function dismissNotice(id: string) {
  set({ notices: state.notices.filter((n) => n.id !== id) });
}

function enqueue(a: Omit<QueuedAction, 'at'>) {
  load();
  set({ pending: [...state.pending, { ...a, at: Date.now() }] });
}

export type SendResult<T> = { queued: true } | { queued: false; data: T };

/** Send now, or queue for replay if the network is down. */
export async function sendOrQueue<T>(method: QueuedAction['method'], path: string, body: unknown, label: string): Promise<SendResult<T>> {
  const key = newKey();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueue({ key, method, path, body, label });
    return { queued: true };
  }
  try {
    const data = await api<T>(path, { method, body, idempotencyKey: key });
    return { queued: false, data };
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'network_error' || e.code === 'api_unreachable')) {
      enqueue({ key, method, path, body, label });
      return { queued: true };
    }
    throw e;
  }
}

export async function replay(): Promise<void> {
  load();
  if (state.replaying || !state.pending.length) return;
  set({ replaying: true });
  const notices: SyncNotice[] = [];
  let remaining = [...state.pending];
  try {
    while (remaining.length) {
      const a = remaining[0]!;
      if (Date.now() - a.at > OFFLINE_MAX_AGE_MS) {
        notices.push({ id: a.key, label: a.label, kind: 'expired' });
        remaining = remaining.slice(1);
        continue;
      }
      try {
        await api(a.path, { method: a.method, body: a.body, idempotencyKey: a.key });
        notices.push({ id: a.key, label: a.label, kind: 'synced' });
        remaining = remaining.slice(1);
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'network_error' || e.code === 'api_unreachable' || e.code === 'session_locked')) break;
        notices.push({ id: a.key, label: a.label, kind: 'conflict', code: e instanceof ApiError ? e.code : 'internal_error' });
        remaining = remaining.slice(1);
      }
    }
  } finally {
    set({ pending: remaining, notices: [...state.notices, ...notices].slice(-20), replaying: false });
  }
}

/** Drop queued actions older than the 5-minute window (called periodically while offline). */
export function expireStale() {
  load();
  const stale = state.pending.filter((a) => Date.now() - a.at > OFFLINE_MAX_AGE_MS);
  if (!stale.length) return;
  set({
    pending: state.pending.filter((a) => Date.now() - a.at <= OFFLINE_MAX_AGE_MS),
    notices: [...state.notices, ...stale.map((a) => ({ id: a.key, label: a.label, kind: 'expired' as const }))].slice(-20),
  });
}
