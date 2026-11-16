import { API_URL, ORG_SLUG, REVALIDATE } from './config';

export type ApiResult<T> = { ok: true; data: T; status: number } | { ok: false; data: null; status: number };

/**
 * Server-side fetch of public catalogue data (no PHI). Cached in the Next data cache for REVALIDATE seconds.
 * Never throws: an offline API yields { ok: false, status: 0 } so pages render an "unavailable" state (and `next build` succeeds).
 */
export async function publicGet<T>(path: string, query?: Record<string, string | number | undefined | null>, revalidate = REVALIDATE): Promise<ApiResult<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `${API_URL}/v1/${path.replace(/^\//, '')}${qs.size ? `?${qs}` : ''}`;
  try {
    const res = await fetch(url, {
      headers: { 'x-org': ORG_SLUG, accept: 'application/json' },
      next: { revalidate, tags: ['public'] },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    return { ok: true, data: (await res.json()) as T, status: res.status };
  } catch {
    return { ok: false, data: null, status: 0 };
  }
}

export async function publicList<T>(path: string, query?: Record<string, string | number | undefined | null>): Promise<T[] | null> {
  const r = await publicGet<T[]>(path, query);
  return r.ok && Array.isArray(r.data) ? r.data : null;
}
