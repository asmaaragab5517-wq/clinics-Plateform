import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, usePathname, useRootNavigationState, type Href } from 'expo-router';
import { routeForPath } from './deepLinks';
import { useSession } from './session';

/** Each tapped notification is routed once, whether it arrives via the listener, the cold-start response, or both. */
const handled = new Set<string>();

/** Notification tap → app route from `data.path` (docs/integrations/push.md), or null (other action, unknown path, seen). */
export function routeForResponse(r: Notifications.NotificationResponse | null | undefined): Href | null {
  if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const key = `${r.notification.request.identifier}:${r.notification.date}`;
  if (handled.has(key)) return null;
  handled.add(key);
  const data = r.notification.request.content.data as { path?: unknown } | null | undefined;
  return typeof data?.path === 'string' ? routeForPath(data.path) : null;
}

function lastResponse(): Promise<Notifications.NotificationResponse | null> {
  try {
    return Promise.resolve(Notifications.getLastNotificationResponse());
  } catch {
    return Notifications.getLastNotificationResponseAsync().catch(() => null);
  }
}

/**
 * Routes notification taps (FR-APP-5): the response listener while the app runs, and the last response at cold start.
 * A route is held until the router is mounted, the session is loaded and the entry redirect (`/` → mode home or
 * sign-in) has happened, so the deep link lands on top of the right stack. Push is patient-only, so a tap switches
 * a dual-session device to patient mode; without a patient session the patient layout sends the user to sign-in.
 */
export function usePushNavigation(): void {
  const nav = useRootNavigationState();
  const pathname = usePathname();
  const { ready, hasPatient, mode, setMode } = useSession();
  const [pending, setPending] = useState<Href | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let live = true;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const to = routeForResponse(r);
      if (to) setPending(to);
    });
    void lastResponse().then((r) => {
      const to = routeForResponse(r);
      if (!r) return;
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
      if (to && live) setPending(to);
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const navReady = !!nav?.key && ready && !!pathname && pathname !== '/';
  useEffect(() => {
    if (!pending || !navReady) return;
    setPending(null);
    if (hasPatient && mode !== 'patient') void setMode('patient');
    router.push(pending);
  }, [pending, navReady, hasPatient, mode, setMode]);
}
