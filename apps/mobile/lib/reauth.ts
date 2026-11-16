import { getStaffTokens, isApiError, setStaffTokens } from './api';
import { signInWithKeycloak } from './oidc';

/**
 * IAM-3: encounter sign-off and prescription issue need auth_time within 12 h. On `reauthentication_required`
 * a Keycloak session is renewed interactively (prompt=login, max_age=0) and the call retried once.
 * Development tokens cannot be renewed in-app: the caller tells the user to paste a fresh token.
 */
export async function withReauth<T>(fn: () => Promise<T>, locale: 'ar' | 'en'): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isApiError(e, 'reauthentication_required')) throw e;
    const cur = getStaffTokens();
    if (cur?.source !== 'keycloak') throw e;
    const r = await signInWithKeycloak({ locale, reauthenticate: true });
    if (!r.ok) throw e;
    await setStaffTokens(r.tokens);
    return fn();
  }
}
