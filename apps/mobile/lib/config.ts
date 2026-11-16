import Constants from 'expo-constants';

/** Runtime configuration (EXPO_PUBLIC_* are inlined by Expo at build time). */
const stripSlash = (s: string) => s.replace(/\/+$/, '');

export const API_URL = stripSlash(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000');
export const ORG_SLUG = process.env.EXPO_PUBLIC_ORG_SLUG ?? 'demo';
export const KEYCLOAK_ISSUER = process.env.EXPO_PUBLIC_KEYCLOAK_ISSUER ? stripSlash(process.env.EXPO_PUBLIC_KEYCLOAK_ISSUER) : '';
export const KEYCLOAK_CLIENT_ID = process.env.EXPO_PUBLIC_KEYCLOAK_CLIENT_ID ?? '';
export const OIDC_ENABLED = !!KEYCLOAK_ISSUER && !!KEYCLOAK_CLIENT_ID;
/** The paste-a-token staff form is a development aid only. */
export const DEV_STAFF_TOKEN = process.env.EXPO_PUBLIC_ALLOW_DEV_STAFF_TOKEN === '1' || process.env.NODE_ENV === 'development';

export const LINK_DOMAINS: string[] = ((Constants.expoConfig?.extra as { linkDomains?: string[] } | undefined)?.linkDomains ?? []).filter(Boolean);

/**
 * Feature flags for API capabilities that do not exist yet.
 * Prescription/invoice PDFs are served only with a bearer header; the in-app browser cannot send one and no
 * file-system module is installed to save the bytes, so the PDF buttons need a signed-URL endpoint like
 * GET /v1/portal/documents/:id/url. Until then the app shows the prescription in-app (README "Stubbed").
 */
export const FEATURES = {
  signedPdfUrls: false,
} as const;

if (!__DEV__ && API_URL.startsWith('http://')) {
  // FR-APP-4: release builds must never talk cleartext. Fail loudly at startup instead of silently.
  throw new Error('EXPO_PUBLIC_API_URL must be https in release builds');
}
