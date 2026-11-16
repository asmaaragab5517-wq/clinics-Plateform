'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BffError, bff } from '@/lib/bff';
import type { Locale } from '@/lib/i18n';
import type { PortalPatient } from '@/lib/types';

export function signInUrl(locale: Locale, next?: string): string {
  const n = next ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '');
  return `/${locale}/portal/sign-in${n ? `?next=${encodeURIComponent(n)}` : ''}`;
}

export function redirectToSignIn(locale: Locale): void {
  window.location.replace(signInUrl(locale));
}

/** GET a BFF resource; a 401 sends the patient to sign-in. */
export function useBffData<T>(url: string | null, locale: Locale, opts: { redirectOn401?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const seq = useRef(0);
  const redirect = opts.redirectOn401 ?? true;

  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await bff<T>(url);
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n !== seq.current) return;
      if (redirect && e instanceof BffError && e.code === 'unauthorized') {
        redirectToSignIn(locale);
        return;
      }
      setError(e);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url, locale, redirect]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function patientName(p: Pick<PortalPatient, 'first_name_ar' | 'father_name_ar' | 'family_name_ar' | 'name_en'>, locale: Locale): string {
  if (locale === 'en' && p.name_en) return p.name_en;
  return [p.first_name_ar, p.father_name_ar, p.family_name_ar].filter(Boolean).join(' ');
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
