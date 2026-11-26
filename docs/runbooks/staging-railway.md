# Staging on Railway

Project `healthflow-staging`, environment `staging`. Demo data, simulated providers (HealthPay, Cequens, storage,
antivirus), real Keycloak sign-in with TOTP. Production stays on the DigitalOcean/Vercel plan in `deploy.md`.

| Service | Source | Notes |
|---|---|---|
| Postgres | `ghcr.io/railwayapp-templates/postgres-ssl:16` | App database (volume). |
| keycloak-db | same image | Keycloak's database (volume). |
| Redis | `redis:8.2` | Cache, rate limits, BullMQ. |
| api | `apps/api/Dockerfile` | Pre-deploy: `migrate-cli.js && seed-cli.js --demo --if-missing`. Health `/health`. |
| worker | `apps/api/Dockerfile`, start `node apps/worker/dist/main.js` | Scheduled jobs. |
| keycloak | `infra/keycloak/Dockerfile` | Imports `realm-healthflow-staging.json` on first start. |
| site | `infra/docker/web.Dockerfile`, `APP=site` | Patient website. |
| console | `infra/docker/web.Dockerfile`, `APP=console` | Staff console, `AUTH_MODE=oidc`. |

Public URLs: api `api-staging-ff474303.up.railway.app`, keycloak `keycloak-staging-896923b8.up.railway.app`,
site `site-staging-2bb92172.up.railway.app`, console `console-staging-2e8d0a72.up.railway.app`.

## Wiring
- Secrets are Railway variables; values shared by several services are environment-level shared variables
  (`CLIENT_IP_SECRET`, `HF_KC_CONSOLE_SECRET`, `HF_KC_ADMIN_SECRET`, `HF_DB_APP_PASSWORD`, `HF_KC_STAFF_TEMP_PASSWORD`),
  referenced as `${{shared.NAME}}`. Database and Redis URLs are references to those services.
- The site and console call the API over the private network (`http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000`); the API
  listens on `::` for that reason.
- Keycloak resolves the realm placeholders (`HF_CONSOLE_URL`, client secrets, temporary staff password) from its
  variables at import. The realm is imported once: later edits to the realm file need the realm deleted in the
  Keycloak admin console (or a fresh keycloak-db) to take effect.

## Signing in
- Staff: the console's "Sign in with organisation SSO" goes to Keycloak. Demo staff usernames are the seeded emails
  (e.g. `owner@demo.healthflow.eg`); the first password is the shared variable `HF_KC_STAFF_TEMP_PASSWORD` (Railway →
  project → Variables). First sign-in asks for a new password and an authenticator app, then one more sign-in with a code.
- Keycloak admin: `https://keycloak-staging-896923b8.up.railway.app/admin`, user `hf-admin`, password in the keycloak
  service variable `KC_BOOTSTRAP_ADMIN_PASSWORD`.
- Patients: SMS sign-in uses the simulated Cequens provider, so codes are not delivered on staging.

## Limits of this environment
- Uploaded files live in memory (`STORAGE_MODE=memory`) and are lost on restart; switch to a Railway bucket (S3) when needed.
- Payments, SMS/WhatsApp, e-receipts, telemedicine and AI run against fakes.
