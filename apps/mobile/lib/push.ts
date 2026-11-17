import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { hasPatientSession, platformName } from './api';
import { portalApi } from './endpoints';
import { KEYS, deleteSecret, getSecret, setSecret } from './storage';

/**
 * FR-COM-7: per-device push token (FCM on Android, APNs on iOS — the raw device token, not an Expo push token,
 * because the API sends through FCM/APNs directly). Registered with POST /v1/portal/devices for the signed-in
 * patient account. Never subscribes to shared topics.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function registerForPush(opts: { prompt: boolean }): Promise<'registered' | 'denied' | 'skipped'> {
  if (!hasPatientSession() || Platform.OS === 'web') return 'skipped';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'HealthFlow', importance: Notifications.AndroidImportance.HIGH });
  }
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && opts.prompt && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return 'denied';
  try {
    const tok = await Notifications.getDevicePushTokenAsync();
    const token = typeof tok.data === 'string' ? tok.data : '';
    if (!token) return 'skipped';
    const last = await getSecret(KEYS.pushToken);
    if (last !== token) {
      await portalApi.registerDevice(token, platformName());
      await setSecret(KEYS.pushToken, token);
    }
    return 'registered';
  } catch {
    // No Firebase config (google-services.json) / simulator: push is unavailable, the app keeps working.
    return 'skipped';
  }
}

/**
 * Sign-out: detach this device's push token from the patient account (POST /v1/portal/devices/unregister) so a
 * signed-out phone stops receiving the account's notifications. Must run while the patient token is still valid.
 * Best effort: offline or an already-expired session must not block signing out.
 */
export async function unregisterPush(): Promise<void> {
  const token = await getSecret(KEYS.pushToken);
  if (token && hasPatientSession()) await portalApi.unregisterDevice(token).catch(() => undefined);
  await deleteSecret(KEYS.pushToken);
}

/** Re-register when FCM/APNs rotates the token; route notification taps carrying a deep link. */
export function startPushListeners(): () => void {
  const a = Notifications.addPushTokenListener((t) => {
    const token = typeof t.data === 'string' ? t.data : '';
    if (!token || !hasPatientSession()) return;
    void portalApi
      .registerDevice(token, platformName())
      .then(() => setSecret(KEYS.pushToken, token))
      .catch(() => undefined);
  });
  const b = Notifications.addNotificationResponseReceivedListener((r) => {
    const data = r.notification.request.content.data as { path?: unknown } | undefined;
    if (typeof data?.path === 'string' && data.path.startsWith('/')) router.push(data.path as never);
  });
  return () => {
    a.remove();
    b.remove();
  };
}
