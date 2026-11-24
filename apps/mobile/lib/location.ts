import * as Location from 'expo-location';

export type ClockPosition = { lat: number; lng: number; accuracy: number };
export type PositionResult = { ok: true; position: ClockPosition } | { ok: false; reason: 'denied' | 'unavailable' | 'mocked' };

/**
 * One foreground position for a clock-in or clock-out, asked only when the clinic checks a radius. The permission is
 * "while using the app"; nothing runs in the background and the position is not stored on the phone. The server keeps
 * only the verdict and distance, never the coordinates. A position from a mock-location app (Android) is not sent.
 */
export async function clockPosition(timeoutMs = 15000): Promise<PositionResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, reason: 'denied' };
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((ok) => setTimeout(() => ok(null), timeoutMs)),
    ]);
    const last = fix ?? (await Location.getLastKnownPositionAsync({ maxAge: 120000, requiredAccuracy: 200 }));
    if (!last) return { ok: false, reason: 'unavailable' };
    if (last.mocked) return { ok: false, reason: 'mocked' };
    return { ok: true, position: { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: Math.min(5000, Math.max(0, last.coords.accuracy ?? 5000)) } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
