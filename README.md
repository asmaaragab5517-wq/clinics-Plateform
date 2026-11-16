# HealthFlow Clinics

Arabic-first clinic network platform for Egypt: online booking and payment, walk-in queue, electronic medical record,
bilingual prescriptions, billing with 14% VAT and cashier closing, SMS/WhatsApp reminders, network dashboards and
PDPL (Law 151/2020) controls. Requirements: `BRD.md` v1.0 and `SRS.md` v1.0 (November 2026).

> Working title "HealthFlow Clinics" (decision D9). Built as original code; KiviCare is only the functional benchmark (ADR 0001).

## Repository

| Path | What |
|---|---|
| `packages/shared` | Egyptian domain library: National ID decoding, +20 phones, Arabic normalisation, EGP money and VAT engine, Cairo DST-aware availability engine, appointment/bill state machines, queue ordering, SMS segments, cash and commission maths, zod API schemas, ar/en catalogues |
| `packages/db` | SQL migrations (RLS on every table, tenant-bound FKs, hash-chained audit log, booking exclusion constraint, reporting views), tenant transaction gateway, AES-256-GCM SecretBox, seed data |
| `packages/documents` | Bilingual RTL PDF templates (prescription with QR, invoice/receipt, shift report, visit summary, lab request) rendered by headless Chromium with self-hosted Arabic fonts; `.ics` events |
| `packages/ui` | RTL design system (Tailwind preset with CSS-variable tokens, React components) |
| `packages/testkit` | Disposable test database with two organisations |
| `apps/api` | NestJS 11 REST API `/v1` (OpenAPI in `docs/openapi.json`, `/v1/docs` outside production) |
| `apps/worker` | Background jobs (BullMQ): outbox dispatch, reminders, hold expiry, no-shows, waitlist, reconciliation, audit verification, retention, director summary, commissions |
| `apps/site` | Public website + patient portal (Next.js 15 on Vercel) |
| `apps/console` | Staff console: reception, doctor, nurse, cashier, manager, admin, waiting-room display (Next.js 15 on Vercel) |
| `apps/mobile` | Expo React Native app with patient, doctor and reception modes |
| `infra` | Keycloak realm, Terraform (DigitalOcean + Vercel), backups and restore drill, k6 load test |
| `docs` | Sprint plan, ADRs, integrations, runbooks, threat model, Arabic medical glossary |

## Quick start (local)

Requirements: Node 22, pnpm 10, Docker (or local PostgreSQL 16 and Redis 7).

```bash
pnpm install
```

```bash
docker compose up -d postgres redis keycloak minio clamav mailpit
```

```bash
cp .env.example .env && pnpm turbo run build --filter=@hf/api --filter=@hf/worker
```

```bash
DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/healthflow DATABASE_APP_PASSWORD=hf_api pnpm db:migrate
```

```bash
DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/healthflow node packages/db/dist/seed-cli.js --demo
```

```bash
pnpm --filter @hf/api dev
```

Then `pnpm --filter @hf/worker dev`, `pnpm --filter @hf/site dev` (http://localhost:3000) and
`pnpm --filter @hf/console dev` (http://localhost:3001). With `AUTH_DEV_SECRET` set, the console offers a dev login
for the seeded users (`owner@demo.healthflow.eg`, `reception@demo.healthflow.eg`, `ahmed-samy@demo.healthflow.eg`, …).
With `OTP_DEV_ECHO=true` the OTP request response includes the code. HealthPay, Cequens, storage and antivirus
default to development fakes; production refuses to start with any fake or dev setting.

## Tests

```bash
DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres CHROMIUM_PATH=$(which chromium) pnpm test
```

| Suite | Covers |
|---|---|
| `packages/shared` (46) | NID, phones, VAT/rounding, money formatting, availability/DST/Ramadan, queue, SMS segments, i18n parity, privileges |
| `packages/db` (10) | RLS by mode, cross-org insert refusal, audit chain tamper detection, double-booking exclusion, tenant-bound FKs, atomic counters |
| `packages/documents` (3) | PDF rendering, escaping, invoice VAT, `.ics` |
| `apps/api` e2e (14) | The SRS §11 R1 gate flows end to end |
| `apps/api` isolation (3) | **MT-5**: every route × every role × foreign organisation / sibling patient; access policy on every route |
| `apps/worker` (7) | Holds, reminders, no-shows, dispatch, audit verification, retention, summary, commissions, cron in Cairo time |

## Security and privacy

Deny-by-default guard + privilege matrix + PostgreSQL RLS + tenant-bound foreign keys; staff MFA via Keycloak;
patient OTP with strict limits; encrypted National ID / passport / merchant keys; private storage with 5-minute signed
URLs and antivirus; hash-chained append-only audit log of every PHI access; consent versioning, data export,
anonymisation, breach register. See `docs/security/threat-model.md` and `docs/adr/0002-postgres-rls-tenancy.md`.

## Open decisions (SRS §13)

D1 hosting (default DigitalOcean fra1), D3 legal entities/merchants (default one), D4 one app (default yes),
D6 digit style (default Western), D8 telemedicine (R2), D9 brand, D10 drug database licence, D11 Expo, D12 retention
(default 10 years). Integration contracts to confirm with HealthPay and Cequens are listed in `docs/integrations`.
