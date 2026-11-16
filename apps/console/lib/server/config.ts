/** Server-side configuration for the BFF. Never imported by client components. */
export const serverConfig = {
  get apiUrl() {
    return (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  },
  get orgSlug() {
    return process.env.ORG_SLUG ?? 'demo';
  },
  get authMode(): 'dev' | 'oidc' {
    return process.env.AUTH_MODE === 'oidc' ? 'oidc' : 'dev';
  },
  get issuer() {
    return (process.env.KEYCLOAK_ISSUER ?? '').replace(/\/$/, '');
  },
  get clientId() {
    return process.env.KEYCLOAK_CLIENT_ID ?? 'healthflow-console';
  },
  get clientSecret() {
    return process.env.KEYCLOAK_CLIENT_SECRET ?? '';
  },
  get consoleUrl() {
    return (process.env.CONSOLE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  },
  get sessionSecret() {
    const s = process.env.SESSION_SECRET;
    if (!s && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required');
    return s ?? 'dev-only-session-secret-change-me';
  },
  get secureCookies() {
    return process.env.NODE_ENV === 'production';
  },
};

/** Idle timeout on shared reception PCs (IAM-2). */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
