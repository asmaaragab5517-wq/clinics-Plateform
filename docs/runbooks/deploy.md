# Deploy runbook

1. Merge to `main` → CI (`.github/workflows/ci.yml`) must be green: RTL lint, typecheck, unit, RLS, documents, API
   acceptance, **MT-5 isolation suite**, worker, web builds, gitleaks, Semgrep, dependency audit.
2. `deploy.yml` builds `ghcr.io/<owner>/clinics-plateform-api:<sha>` and rolls it to **staging**; the App Platform
   pre-deploy job runs `packages/db/dist/migrate-cli.js` with owner credentials.
3. Production requires approval on the `production` GitHub environment (SRS §2.2).
4. Vercel deploys `apps/site` and `apps/console` from Git; previews point at the staging API.
5. Smoke test: `GET /health`, public doctors list, OTP request to a test number, console login, display screen stream.

Rollback: redeploy the previous image tag (migrations are forward-only and additive; write a new migration to revert).
