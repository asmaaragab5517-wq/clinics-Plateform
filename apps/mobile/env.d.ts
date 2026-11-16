/// <reference types="expo/types" />

// Expo inlines EXPO_PUBLIC_* variables at build time (never put secrets in them).
// `types: []` in tsconfig keeps Node typings (hoisted at the monorepo root) out of the RN app.
declare const process: {
  env: {
    NODE_ENV?: 'development' | 'production' | 'test';
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_ORG_SLUG?: string;
    EXPO_PUBLIC_KEYCLOAK_ISSUER?: string;
    EXPO_PUBLIC_KEYCLOAK_CLIENT_ID?: string;
    EXPO_PUBLIC_ALLOW_DEV_STAFF_TOKEN?: string;
    [key: string]: string | undefined;
  };
};
