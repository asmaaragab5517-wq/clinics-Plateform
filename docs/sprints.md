# Delivery sprints

The BRD roadmap (§10) mapped onto sprints. Each sprint is one commit series on `main`; CI must be green.

| Sprint | Release | Scope | BR / SRS | Status |
|---|---|---|---|---|
| 0 | R0 | Monorepo (pnpm + Turborepo), `@hf/shared` Egyptian domain library (National ID, +20 phones, Arabic normalisation, EGP + 14% VAT, Cairo DST availability, state machines, SMS segments, cash and commission maths, zod schemas, ar/en i18n), `@hf/db` SQL migrations with RLS, hash-chained audit log, booking exclusion constraint, SecretBox encryption, seed data | MT-1..4, FR-PRV-3, LOC-* | Done |
| 1 | R1 | Auth (patient OTP + rotating refresh, staff Keycloak/dev tokens, PIN unlock), organisation, clinics, legal entities, services, price lists, packages, staff, doctor profiles, commissions | BR-1, BR-2, IAM-1..5, FR-ORG, FR-STF | Done |
| 2 | R1 | Schedules, exceptions, Ramadan profiles, availability, booking with holds, status machine, walk-in queue, SSE, waiting-room display, follow-ups, waitlist | BR-3, BR-4, FR-SCH, FR-APT | Done |
| 3 | R1 | Patient registry (encrypted NID, duplicates, merge/un-merge, consents, break-glass), EMR (vitals, ICD-10, sign-off, addenda, orders, documents), prescriptions (safety checks, bilingual PDF with QR, share links) | BR-5..7, FR-PAT, FR-EMR, FR-RX | Done |
| 4 | R1 | Billing (VAT engine, discount approvals, credit notes, payments, refunds, cashier shifts, packages), HealthPay intents + signed webhooks + reconciliation, messaging outbox (Cequens, FCM, SMTP), reports and exports, privacy (DSR export/anonymisation, breach register, audit viewer), reviews, imports, CMS | BR-8..10, BR-14..17, FR-BIL, FR-HP, FR-COM, FR-RPT, FR-PRV, FR-REV, FR-IMP | Done |
| 5 | R1 | Worker (reminders, holds, no-shows, waitlist, reconciliation, audit verification, retention, director summary, commissions), MT-5 isolation suite, tenant-bound foreign keys | MT-5, FR-HP-5, FR-PRV-6, FR-RPT-5 | Done |
| 6 | R1 | Infrastructure (Compose, Dockerfile, Keycloak realm, Terraform DO + Vercel), CI/CD, security scanning, backups and restore drill, k6, OpenAPI, ADRs and runbooks | NFR-1..10, SEC-9 | Done |
| 7 | R1 | Public site + patient portal (Next.js on Vercel), staff console (reception, doctor, nurse, cashier, manager, admin, display), mobile app (Expo; patient, doctor, reception modes) | BR-11, BR-12, FR-WEB, FR-APP | Done (gaps in `docs/known-gaps.md`) |
| Pilot | R1 | 1–2 clinics live, UAT, external pentest, live HealthPay transaction, store closed testing | SRS §11 | Pending (needs accounts, D1/D3/D10 decisions) |
| R2 | R2 | Telemedicine (D8), ETA e-receipt, insurance/TPA, Google Calendar, ITQAN feed, drug interactions | BR-13, BR-18 | Not started (schema hooks in place) |
| R3 | R3 | AI scribe (doctor-approved), SaaS administration, public API keys | BR-19, BR-20 | Not started |

## R1 acceptance gate (SRS §11) — automated evidence

| Gate item | Evidence |
|---|---|
| 1. Patient journey in Arabic (find, OTP, book, pay, SMS, check-in, sign-off, prescription QR, rating) | `apps/api/test/e2e.test.ts` › online journey + reception/doctor flows |
| 2. Walk-in with NID validation, ticket, display, cash, shift report | e2e › reception, doctor, cashier |
| 3. Cross-clinic doctor sees history with audit; receptionist cannot see notes | e2e › "receptionist cannot read clinical notes…" |
| 4. Isolation suite 100% | `apps/api/test/isolation.test.ts`, `packages/db/test/rls.test.ts` |
| 5. Dashboard matches SQL ground truth | e2e › "director dashboard matches SQL ground truth" |
| 6. NFR-2 performance, NFR-4 restore drill | `infra/load/k6-booking.js`, `.github/workflows/backup.yml` (to run on staging) |
| 7. PDPL controls | consent versioning, export, anonymisation, audit verification — e2e › privacy |
| 8. Lighthouse ≥ 90, axe, RTL screenshots | to run against staging deploy |
| 9. TestFlight / Play closed track | needs Apple/Google organisation accounts |
