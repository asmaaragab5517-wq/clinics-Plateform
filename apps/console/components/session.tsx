'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import type { Clinic, Me } from '@/lib/types';

export interface SessionValue {
  me: Me;
  privileges: Set<string>;
  can: (...anyOf: string[]) => boolean;
  hasRole: (...roles: string[]) => boolean;
  clinicId: string;
  clinic: Clinic | undefined;
  setClinicId: (id: string) => void;
}

export const SessionCtx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('SessionCtx missing');
  return v;
}

/** Page-level keyboard shortcuts (NFR-5). The shell owns the listener; pages register handlers. */
export type ShortcutMap = Partial<Record<string, () => void>>;
export interface ShortcutRegistry {
  register: (map: ShortcutMap) => () => void;
}
export const ShortcutCtx = createContext<ShortcutRegistry>({ register: () => () => undefined });

export function useShortcuts(map: ShortcutMap) {
  const reg = useContext(ShortcutCtx);
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const proxy: ShortcutMap = {};
    for (const k of Object.keys(ref.current)) proxy[k] = () => ref.current[k]?.();
    return reg.register(proxy);
  }, [reg, Object.keys(map).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}
