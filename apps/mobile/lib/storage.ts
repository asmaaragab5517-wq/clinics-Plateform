import * as SecureStore from 'expo-secure-store';

/**
 * Everything the app persists goes through expo-secure-store (iOS Keychain / Android Keystore-backed
 * EncryptedSharedPreferences), FR-APP-4. AsyncStorage and expo-file-system are deliberately not used.
 *
 * SecureStore values should stay small (iOS warns above ~2 KB per item), so JSON documents are split into
 * chunks of CHUNK characters under `<key>.0`, `<key>.1` … with the chunk count in `<key>.n`.
 */
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const CHUNK = 1800;
/** Upper bound for one cached document (characters). Callers trim lists before caching. */
export const MAX_JSON_CHARS = CHUNK * 24;

const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

export async function getSecret(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(safeKey(key), OPTS);
  } catch {
    // Keystore can be invalidated (e.g. device lock removed). Treat as missing.
    return null;
  }
}

/** Synchronous read, used only at startup for non-sensitive preferences (locale). */
export function getSecretSync(key: string): string | null {
  try {
    return SecureStore.getItem(safeKey(key), OPTS);
  } catch {
    return null;
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(safeKey(key), value, OPTS);
}

export async function deleteSecret(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(safeKey(key), OPTS);
  } catch {
    /* already gone */
  }
}

export async function setJson(key: string, value: unknown): Promise<boolean> {
  const s = JSON.stringify(value);
  if (s.length > MAX_JSON_CHARS) return false;
  const n = Math.max(1, Math.ceil(s.length / CHUNK));
  const prev = Number((await getSecret(`${key}.n`)) ?? '0');
  for (let i = 0; i < n; i++) await setSecret(`${key}.${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK));
  for (let i = n; i < prev; i++) await deleteSecret(`${key}.${i}`);
  await setSecret(`${key}.n`, String(n));
  return true;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const n = Number((await getSecret(`${key}.n`)) ?? '0');
  if (!n) return null;
  let s = '';
  for (let i = 0; i < n; i++) {
    const part = await getSecret(`${key}.${i}`);
    if (part == null) return null;
    s += part;
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function deleteJson(key: string): Promise<void> {
  const n = Number((await getSecret(`${key}.n`)) ?? '0');
  for (let i = 0; i < n; i++) await deleteSecret(`${key}.${i}`);
  await deleteSecret(`${key}.n`);
}

/** Storage keys in one place so sign-out can wipe them. */
export const KEYS = {
  locale: 'hf.locale',
  rtlReload: 'hf.rtlReload',
  patientSession: 'hf.session.patient',
  staffSession: 'hf.session.staff',
  mode: 'hf.mode',
  clinic: 'hf.clinic',
  biometric: 'hf.biometric',
  deviceId: 'hf.deviceId',
  pushToken: 'hf.pushToken',
  cacheUpcoming: 'hf.cache.upcoming',
  cachePrescriptions: 'hf.cache.rx',
} as const;
