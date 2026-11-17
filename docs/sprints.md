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
| 15 | R2 | Dental tooth chart (FDI, surfaces, treatment plan, merged history, PDF); reference-data import CLI (drugs, interactions, ICD-10); 30-day next-available cache; retention review (D12); portal coverages; app payment return and push deep links; waitlist management | FR-EMR-3, D10, D12, FR-WEB-2, FR-APP-5 | Done |
| 17 | Gate | Quality gate: public catalogue response cache (per-org, invalidated on writes, CDN Cache-Control), one-round-trip tenant setup, pool size and optional cluster mode (`API_WORKERS`); `scripts/perf.mjs` NFR-2 smoke; `packages/ui-tests` axe + RTL overflow + screenshots + Lighthouse | NFR-2, NFR-7, SRS §11 gate 6/8 | Done (perf); UI gate runs after Sprint 16 screens |
| Pilot | R1 | 1–2 clinics live, UAT, external pentest, live HealthPay transaction, store closed testing | SRS §11 | Pending (needs accounts, D1/D3/D10 decisions) |
| 8 | R1+ | Gap closure: next-available/city search, public photos, booking funnel, rate limiting, body chart PNG, consent signature | FR-WEB-2/3, SEC-5, FR-EMR-2, FR-PRV-2 | Done |
| 9 | R2 | Telemedicine (Zoom S2S / Google Meet / fake), waiting room, Google Calendar one-way sync | BR-13, FR-TEL-1..4, FR-INT-2 | Done |
| 10 | R2 | ETA e-receipts (chained UUIDs, retry queue, QR), insurance/TPA (payers, plans, coverage split, claim batches, settlement), drug interactions | FR-BIL-10, FR-BIL-11, FR-RX-3 | Done |
| 11 | R2 | Complaints and incident registers; signed, pseudonymised outbound webhooks (ITQAN feed) with SSRF guard and retries; low ratings forwarded | FR-INT-1, FR-REV-3, BR-18 | Done |
| 12 | R3 | AI scribe: dictation → structured draft, patient summary, prescription wording; doctor approval, PHI minimisation, governance | BR-19, FR-EMR-9 | Done (ADR 0007) |
| 13 | R3 | SaaS administration: platform admins, organisation onboarding, plans and limits, usage, HealthPay platform invoices, announcements, owner-approved read-only support access; public read-only API with hashed scoped keys | BR-20, FR-ADM-1, FR-INT-3 | Done |
| 14 | R2/R3 | Console, site and mobile screens for sprints 8–13 (telemedicine, AI review, insurance and claims, ETA, quality, integrations, API keys, subscription, support approvals, platform admin area) | BR-11..20 | Done |

## R1 acceptance gate (SRS §11) — automated evidence

| Gate item | Evidence |
|---|---|
| 1. Patient journey in Arabic (find, OTP, book, pay, SMS, check-in, sign-off, prescription QR, rating) | `apps/api/test/e2e.test.ts` › online journey + reception/doctor flows |
| 2. Walk-in with NID validation, ticket, display, cash, shift report | e2e › reception, doctor, cashier |
| 3. Cross-clinic doctor sees history with audit; receptionist cannot see notes | e2e › "receptionist cannot read clinical notes…" |
| 4. Isolation suite 100% | `apps/api/test/isolation.test.ts`, `packages/db/test/rls.test.ts` |
| 5. Dashboard matches SQL ground truth | e2e › "director dashboard matches SQL ground truth" |
| 6. NFR-2 performance, NFR-4 restore drill | `scripts/perf.mjs` (sandbox, 200 VUs, 4 vCPU shared with Postgres and the load generator: slots p95 85 ms, catalogue p95 ~70 ms, 0 errors, 4,074 req/s with the cache; uncached a single process is CPU-bound at ~260 req/s, so production needs ≥2 replicas or `API_WORKERS`); `infra/load/k6-booking.js` and `.github/workflows/backup.yml` still to run on staging |
| 7. PDPL controls | consent versioning, export, anonymisation, audit verification — e2e › privacy |
| 8. Lighthouse ≥ 90, axe, RTL screenshots | `packages/ui-tests/run.mjs` (local servers); repeat on the staging deploy |
| 9. TestFlight / Play closed track | needs Apple/Google organisation accounts |
