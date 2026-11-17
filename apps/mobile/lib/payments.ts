import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { PAYMENT_RETURN_URL, claimPaymentReturn, expectPaymentReturn } from './deepLinks';

/**
 * HealthPay hosted checkout (FR-HP-1) in an auth session that closes itself when the gateway redirects to
 * `healthflow://book/result?ref=…&appointment=…`. Closing it by hand also continues. The result screen polls the
 * appointment because the webhook, not the redirect, is the source of truth (FR-HP-3).
 */
export async function openCheckout(checkoutUrl: string, a: { ref: string; id: string }, nav: 'replace' | 'push'): Promise<void> {
  expectPaymentReturn(a.ref);
  await WebBrowser.openAuthSessionAsync(checkoutUrl, PAYMENT_RETURN_URL, { dismissButtonStyle: 'close' }).catch(() => null);
  if (!claimPaymentReturn(a.ref)) return; // the deep link already opened the result screen
  const href = { pathname: '/patient/payment-result' as const, params: { ref: a.ref, id: a.id } };
  if (nav === 'replace') router.replace(href);
  else router.push(href);
}
