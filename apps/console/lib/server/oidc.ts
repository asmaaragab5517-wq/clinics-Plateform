import { serverConfig } from './config';
import { jwtPayload, type SessionTokens } from './session';

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  issuer: string;
}

let cached: { at: number; doc: Discovery } | null = null;

export async function discovery(): Promise<Discovery> {
  if (cached && Date.now() - cached.at < 3600_000) return cached.doc;
  if (!serverConfig.issuer) throw new Error('KEYCLOAK_ISSUER is not configured');
  const r = await fetch(`${serverConfig.issuer}/.well-known/openid-configuration`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
  const doc = (await r.json()) as Discovery;
  if (doc.issuer.replace(/\/$/, '') !== serverConfig.issuer) throw new Error('OIDC issuer mismatch');
  cached = { at: Date.now(), doc };
  return doc;
}

export const redirectUri = () => `${serverConfig.consoleUrl}/api/auth/callback`;
/** The platform-admin area signs in through its own callback so its tokens land in the platform cookies. */
export const platformRedirectUri = () => `${serverConfig.consoleUrl}/api/platform/auth/callback`;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  id_token?: string;
}

function toSession(t: TokenResponse): SessionTokens {
  const idClaims = t.id_token ? jwtPayload(t.id_token) : {};
  return {
    accessToken: t.access_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    refreshToken: t.refresh_token ?? null,
    refreshExpiresAt: t.refresh_expires_in ? Date.now() + t.refresh_expires_in * 1000 : null,
    idToken: t.id_token ?? null,
    email: typeof idClaims.email === 'string' ? idClaims.email : null,
    mode: 'oidc',
  };
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const d = await discovery();
  const body = new URLSearchParams({ client_id: serverConfig.clientId, ...params });
  if (serverConfig.clientSecret) body.set('client_secret', serverConfig.clientSecret);
  const r = await fetch(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' });
  if (!r.ok) throw new Error(`token endpoint ${r.status}`);
  return (await r.json()) as TokenResponse;
}

export async function exchangeCode(code: string, verifier: string, nonce: string, redirect: string = redirectUri()): Promise<SessionTokens> {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });
  if (t.id_token) {
    const claims = jwtPayload(t.id_token);
    if (claims.nonce !== nonce) throw new Error('nonce mismatch');
    if (String(claims.iss ?? '').replace(/\/$/, '') !== serverConfig.issuer) throw new Error('issuer mismatch');
  }
  return toSession(t);
}

export async function refreshTokens(refreshToken: string): Promise<SessionTokens> {
  return toSession(await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }));
}
