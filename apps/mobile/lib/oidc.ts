import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { KEYCLOAK_CLIENT_ID, KEYCLOAK_ISSUER, OIDC_ENABLED } from './config';
import { asciiBytes, base64url, sha256 } from './sha256';
import { randomToken } from './random';

/**
 * Staff sign-in with Keycloak: OAuth 2.0 authorization code + PKCE (S256) in the system browser
 * (ASWebAuthenticationSession / Custom Tabs via expo-web-browser). Public client, no secret in the app.
 *
 * Keycloak client "healthflow-mobile" (see README "Keycloak client"):
 *   - Client authentication OFF (public), Standard flow ON, Direct access grants OFF
 *   - PKCE method S256 required (Advanced → Proof Key for Code Exchange)
 *   - Valid redirect URIs: healthflow://oauth/callback (plus exp://… for Expo Go in development)
 *   - Audience mapper adding "healthflow-api" (the API checks KEYCLOAK_AUDIENCE)
 *   - Refresh token rotation recommended (Realm → Tokens → Revoke Refresh Token)
 */
export interface StaffTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  source: 'keycloak' | 'dev';
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
}

let discovery: Discovery | null = null;

async function discover(): Promise<Discovery> {
  if (discovery) return discovery;
  try {
    const r = await fetch(`${KEYCLOAK_ISSUER}/.well-known/openid-configuration`);
    if (r.ok) discovery = (await r.json()) as Discovery;
  } catch {
    /* fall back to Keycloak's fixed paths */
  }
  discovery ??= {
    authorization_endpoint: `${KEYCLOAK_ISSUER}/protocol/openid-connect/auth`,
    token_endpoint: `${KEYCLOAK_ISSUER}/protocol/openid-connect/token`,
    end_session_endpoint: `${KEYCLOAK_ISSUER}/protocol/openid-connect/logout`,
  };
  return discovery;
}

export const redirectUri = () => Linking.createURL('oauth/callback');

const form = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

function toTokens(j: { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number }): StaffTokens {
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    idToken: j.id_token,
    expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    source: 'keycloak',
  };
}

export type OidcResult = { ok: true; tokens: StaffTokens } | { ok: false; reason: 'cancelled' | 'not_configured' | 'state_mismatch' | 'failed' };

/**
 * Interactive sign-in. `reauthenticate` forces a fresh login (prompt=login, max_age=0) so the new token carries
 * a recent auth_time, which the API requires for encounter sign-off and prescription issue (IAM-3).
 */
export async function signInWithKeycloak(opts: { locale: 'ar' | 'en'; reauthenticate?: boolean }): Promise<OidcResult> {
  if (!OIDC_ENABLED) return { ok: false, reason: 'not_configured' };
  const d = await discover();
  const verifier = randomToken(3); // 96 chars from [0-9a-f], within RFC 7636's 43..128
  const challenge = base64url(sha256(asciiBytes(verifier)));
  const state = randomToken(1);
  const nonce = randomToken(1);
  const redirect = redirectUri();
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: redirect,
    scope: 'openid profile offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    ui_locales: opts.locale,
  };
  if (opts.reauthenticate) {
    params.prompt = 'login';
    params.max_age = '0';
  }
  const res = await WebBrowser.openAuthSessionAsync(`${d.authorization_endpoint}?${form(params)}`, redirect, { preferEphemeralSession: true });
  if (res.type !== 'success') return { ok: false, reason: 'cancelled' };
  const { queryParams } = Linking.parse(res.url);
  const q = (k: string) => {
    const v = queryParams?.[k];
    return Array.isArray(v) ? v[0] : v ?? undefined;
  };
  if (q('state') !== state) return { ok: false, reason: 'state_mismatch' };
  const code = q('code');
  if (!code || q('error')) return { ok: false, reason: 'failed' };
  try {
    const r = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ grant_type: 'authorization_code', client_id: KEYCLOAK_CLIENT_ID, code, redirect_uri: redirect, code_verifier: verifier }),
    });
    if (!r.ok) return { ok: false, reason: 'failed' };
    return { ok: true, tokens: toTokens(await r.json()) };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Refresh-token grant. Keycloak may rotate the refresh token; the caller stores whatever comes back. */
export async function refreshKeycloak(refreshToken: string): Promise<StaffTokens | null> {
  if (!OIDC_ENABLED) return null;
  const d = await discover();
  const r = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'refresh_token', client_id: KEYCLOAK_CLIENT_ID, refresh_token: refreshToken }),
  });
  if (!r.ok) return null;
  const t = toTokens(await r.json());
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

/** Back-channel logout for a public client (revokes the refresh token / SSO session). */
export async function logoutKeycloak(t: StaffTokens): Promise<void> {
  if (!OIDC_ENABLED || t.source !== 'keycloak' || !t.refreshToken) return;
  try {
    const d = await discover();
    if (!d.end_session_endpoint) return;
    await fetch(d.end_session_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: KEYCLOAK_CLIENT_ID, refresh_token: t.refreshToken }),
    });
  } catch {
    /* best effort */
  }
}
