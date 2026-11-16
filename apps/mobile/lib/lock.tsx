import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { KEYS, getSecretSync, setSecret } from './storage';

/**
 * FR-APP-4 biometric unlock option. When enabled, the app locks at cold start and when it returns to the
 * foreground after LOCK_AFTER_MS in the background; Face ID / Touch ID / fingerprint (device passcode fallback)
 * unlocks it. Tokens stay in SecureStore; the lock hides content until the user proves presence.
 */
const LOCK_AFTER_MS = 30_000;

interface LockValue {
  enabled: boolean;
  locked: boolean;
  setEnabled: (on: boolean, prompt: string) => Promise<boolean>;
  unlock: (prompt: string, cancel: string) => Promise<boolean>;
}

const Ctx = createContext<LockValue | null>(null);

export async function biometricAvailable(): Promise<boolean> {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => getSecretSync(KEYS.biometric) === '1');
  const [locked, setLocked] = useState(enabled);
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') backgroundAt.current = Date.now();
      if (st === 'active' && backgroundAt.current != null) {
        if (enabled && Date.now() - backgroundAt.current > LOCK_AFTER_MS) setLocked(true);
        backgroundAt.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const unlock = useCallback(async (promptMessage: string, cancelLabel: string) => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: false });
    if (r.success) setLocked(false);
    return r.success;
  }, []);

  const setEnabled = useCallback(async (on: boolean, promptMessage: string) => {
    if (on) {
      if (!(await biometricAvailable())) return false;
      const r = await LocalAuthentication.authenticateAsync({ promptMessage });
      if (!r.success) return false;
    }
    await setSecret(KEYS.biometric, on ? '1' : '0');
    setEnabledState(on);
    return true;
  }, []);

  return <Ctx.Provider value={{ enabled, locked, setEnabled, unlock }}>{children}</Ctx.Provider>;
}

export function useLock(): LockValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLock outside LockProvider');
  return v;
}
