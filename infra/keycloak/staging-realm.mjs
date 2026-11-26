// Builds realm-healthflow-staging.json from the base realm for a hosted staging environment (Railway):
// redirect URIs and client secrets come from environment placeholders that Keycloak resolves at import, and the demo staff from
// `seed --demo` are added with the same IDs as their users.keycloak_sub, a temporary password from
// HF_KC_STAFF_TEMP_PASSWORD and TOTP enrolment at first sign-in. Run: node infra/keycloak/staging-realm.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const realm = JSON.parse(readFileSync(new URL('realm-healthflow.json', dir), 'utf8'));
const CONSOLE = '${HF_CONSOLE_URL}';

for (const c of realm.clients) {
  if (c.clientId === 'healthflow-console') {
    c.secret = '${HF_KC_CONSOLE_SECRET}';
    c.redirectUris = [`${CONSOLE}/api/auth/callback`, `${CONSOLE}/api/platform/auth/callback`];
    c.webOrigins = [CONSOLE];
    c.attributes = { ...c.attributes, 'post.logout.redirect.uris': `${CONSOLE}/*` };
  }
  if (c.clientId === 'healthflow-admin') c.secret = '${HF_KC_ADMIN_SECRET}';
}

// keycloak_sub | email | display name, as created by packages/db seedDemo (organisation slug "demo").
const STAFF = [
  ['dev-demo-owner', 'owner@demo.healthflow.eg', 'Network', 'Owner'],
  ['dev-demo-director', 'director@demo.healthflow.eg', 'Network', 'Director'],
  ['dev-demo-manager', 'manager@demo.healthflow.eg', 'Nasr City', 'Manager'],
  ['dev-demo-reception', 'reception@demo.healthflow.eg', 'Demo', 'Receptionist'],
  ['dev-demo-reception2', 'reception2@demo.healthflow.eg', 'Dokki', 'Receptionist'],
  ['dev-demo-nurse', 'nurse@demo.healthflow.eg', 'Demo', 'Nurse'],
  ['dev-demo-accountant', 'accountant@demo.healthflow.eg', 'Demo', 'Accountant'],
  ['dev-demo-dr_ahmed', 'ahmed-samy@demo.healthflow.eg', 'Ahmed', 'Samy'],
  ['dev-demo-dr_mona', 'mona-khaled@demo.healthflow.eg', 'Mona', 'Khaled'],
  ['dev-demo-dr_sara', 'sara-adel@demo.healthflow.eg', 'Sara', 'Adel'],
];
const person = (id, email, firstName, lastName, attributes) => ({
  id, username: email, email, emailVerified: true, enabled: true, firstName, lastName, attributes,
  credentials: [{ type: 'password', value: '${HF_KC_STAFF_TEMP_PASSWORD}', temporary: true }],
  requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
});
realm.users = [
  ...STAFF.map(([id, email, f, l]) => person(id, email, f, l, { org: ['demo'] })),
  person('dev-platform-demo', 'platform@demo.healthflow.eg', 'Platform', 'Admin', {}),
  // The API's identity admin (KEYCLOAK_ADMIN_CLIENT_ID=healthflow-admin) creates and disables staff accounts.
  { username: 'service-account-healthflow-admin', enabled: true, serviceAccountClientId: 'healthflow-admin', clientRoles: { 'realm-management': ['manage-users', 'view-users'] } },
];

writeFileSync(new URL('realm-healthflow-staging.json', dir), JSON.stringify(realm, null, 2) + '\n');
console.log(`wrote realm-healthflow-staging.json with ${realm.users.length} users`);
