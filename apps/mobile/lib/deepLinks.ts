import type { Href } from 'expo-router';

/**
 * FR-APP-5 deep links → app routes. Sources:
 * - push `data.path` (docs/integrations/push.md): `/appointments/<id>`, `/review/<id>`, `/rx`, `/reports`, `/invoices`;
 * - the HealthPay return for app bookings: `healthflow://book/result?ref=…&appointment=…` (payments.ts APP_RETURN_URL);
 * - Universal/App Links on the site domain (same paths, optionally under `/ar` or `/en`).
 * Only these shapes are accepted: anything else returns null and is ignored, so a payload cannot open arbitrary screens.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9_-]{1,40}$/;

function split(path: string): { segments: string[]; query: URLSearchParams } {
  const [p = '', q = ''] = path.split('?', 2);
  const segments = p
    .split('#')[0]!
    .split('/')
    .filter(Boolean)
    .map((x) => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    });
  // The site's locale prefix (`/ar/book/result`) is not part of the app's routes.
  if (segments[0] === 'ar' || segments[0] === 'en') segments.shift();
  return { segments, query: new URLSearchParams(q) };
}

/** Maps a deep-link path (leading slash optional, query allowed) to an app route, or null if it is not one we handle. */
export function routeForPath(path: string): Href | null {
  if (typeof path !== 'string' || path.length > 500) return null;
  const { segments, query } = split(path.trim());
  const [head, id, ...rest] = segments;
  if (rest.length) return null;
  switch (head) {
    case 'appointments':
      if (!id) return '/patient/appointments';
      return UUID.test(id) ? { pathname: '/patient/appointments/[id]', params: { id } } : null;
    case 'review':
      return id && UUID.test(id) ? { pathname: '/patient/review/[id]', params: { id } } : null;
    case 'rx':
    case 'prescriptions':
      return id ? null : '/patient/prescriptions';
    case 'reports':
    case 'documents':
      return id ? null : '/patient/documents';
    case 'invoices':
      return id ? null : '/patient/invoices';
    case 'book': {
      if (id !== 'result') return null;
      return { pathname: '/patient/payment-result', params: paymentParams(query.get('ref'), query.get('appointment') ?? query.get('id')) };
    }
    default:
      return null;
  }
}

/** Params for /patient/payment-result: only well-formed values pass through. */
export function paymentParams(ref: string | null | undefined, appointment: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (ref && REF.test(ref)) out.ref = ref;
  if (appointment && UUID.test(appointment)) out.id = appointment;
  return out;
}

/** The API's return URL for app bookings (payments.ts APP_RETURN_URL); the scheme is app.config.ts `scheme`. */
export const PAYMENT_RETURN_URL = 'healthflow://book/result';

/**
 * The HealthPay return can arrive twice: as the auth-session result (the checkout browser closes on
 * `healthflow://book/result`) and, on Android, also as a deep link that expo-router opens. Whichever handler claims
 * the booking ref first navigates to the result screen; the other one does nothing.
 */
const paymentReturns = new Map<string, boolean>();
export function expectPaymentReturn(ref: string): void {
  paymentReturns.set(ref, false);
}
export function claimPaymentReturn(ref: string | undefined): boolean {
  if (!ref) return true;
  if (paymentReturns.get(ref)) return false;
  paymentReturns.set(ref, true);
  return true;
}
