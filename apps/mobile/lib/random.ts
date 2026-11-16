import { uuid } from 'expo';

/**
 * Random identifiers. `uuid.v4()` from expo-modules-core is generated natively (NSUUID on iOS,
 * java.util.UUID/SecureRandom on Android), i.e. from the platform CSPRNG: 122 random bits per call.
 * There is no JS-side crypto module installed (no expo-crypto), so this is the only CSPRNG source.
 */
export function randomId(): string {
  return uuid.v4();
}

/** High-entropy URL-safe string (n UUIDs, dashes removed): 3 → 96 hex chars, 366 random bits. */
export function randomToken(n = 3): string {
  let s = '';
  for (let i = 0; i < n; i++) s += uuid.v4().replace(/-/g, '');
  return s;
}
