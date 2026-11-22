# Known gaps and follow-ups (end of Sprint 22)

Collected from the build and the front-end integration reviews. None blocks the R1 pilot build; items marked **pilot**
must be closed before go-live.

## Needs external input
- **pilot** HealthPay and Cequens endpoint contracts are assumptions (`docs/integrations`); confirm with each provider.
- **pilot** Licensed Egyptian drug list (D10) and full ICD-10 with Arabic titles; clinician sign-off on `docs/glossary.ar.md` and templates.
- **pilot** Legal texts for consents/privacy/terms (counsel); PDPL hosting opinion (D1).
- **pilot** External penetration test; Lighthouse/axe runs and RTL screenshot approval on staging; k6 run on staging.
- **pilot** Apple/Google organisation accounts for TestFlight/Play closed testing; app icon and splash.
- Docker image build was not exercised in the development sandbox (no registry access); the CI `image` job is the first real build.

## Security and pipeline
- **Dependency audit (CI `security` job) is red** on high advisories: postcss < 8.5.18 (inside Next.js), nodemailer < 10.0.6,
  zod 3.x (fixed only in zod 4.6.6+), picomatch (inside the Expo CLI; no fix released). Planned fix: postcss override 8.5.32,
  nodemailer 10.4.0, zod 4.6.7 (API and shared; the AI module already uses the zod 4 API). Blocked because updating the lockfile
  re-checks packages locked before the 7-day minimum release age was introduced (turbo 2.11.11 binaries, @tybys/wasm-util);
  the install succeeds once those are 7 days old, or with an owner-approved exemption. picomatch needs a documented audit exception.
- Lighthouse performance (mobile, median of 3) in CI: home 93, doctor profile 96, doctors list 90 (one earlier run 86).
  The doctors list sits at the target on GitHub's 2-vCPU runners and may fail occasionally; locally it scores 95–97.
  Confirm on the staging deploy behind the CDN before treating it as a product issue.
- Deploy to staging/production waits for `STAGING_APP_ID`, `PRODUCTION_APP_ID` and `DO_TOKEN` (docs/runbooks/deploy.md).

## HR and payroll (Sprint 19)
- **pilot** Confirm the payroll defaults with the organisation's accountant: social-insurance rates and the yearly
  minimum/maximum insurable wage (defaults hold the 2025 limits and runs warn until updated), income-tax brackets and
  personal exemption, Martyrs' Fund rate, overtime multipliers, leave entitlements. All are editable in HR settings.
- Not modelled (ADR 0008): the income-tax phase-out above EGP 600,000 a year (flagged for
  review), sick-leave pay shared with social insurance, end-of-service gratuity and notice pay (unused annual leave is paid out
  when employment ends).
- Mobile clock-in by GPS radius needs `expo-location` (blocked until the lockfile can change); until then the mobile app
  is verified by the clinic network (phone on the clinic Wi-Fi). The console deliberately does not use browser location.
- Clinic map positions are typed or pasted as numbers (no map picker in the console).

## Product/API
- Mobile features added in Sprints 16–18 (dictation, pending drafts, insurance, video booking, push taps, payment return) have
  not been run on a device or emulator.
- Mobile dictation recordings stay in the app's private cache after upload (deleting needs expo-file-system). Dictation, notification taps and payment return are not yet tested on a device.
- Public catalogue cache: shared through Redis when `REDIS_URL` is set (writes invalidate every replica at once); without Redis, or while it is unreachable, each replica falls back to its own cache, which converges within `PUBLIC_CACHE_SECONDS`.
- Uncached public reads cost ~2–14 ms CPU each; the sandbox load test saturates one Node process at ~260 req/s, so size replicas from the staging k6 run.
- Idempotency-Key is honoured on every staff and patient write (stored responses kept 24 hours, replayed on retry); bookings,
  walk-ins and payments also keep their own per-record keys. A multipart upload's key covers its form fields, not the file bytes.
- Mobile: live queue uses polling (SSE in web), screenshot blocking is app-wide on Android only, root/jailbreak warning not implemented, certificate pins must be supplied (`CERT_PINS`).
- Concurrent refreshes from several site instances are tolerated: a token rotated less than 10 s earlier, whose successor
  is still live, gets another token in the same family; replays after that window still revoke the family.
- R2/R3 integrations are built against fakes; each needs a real-account check: Zoom/Google OAuth apps, ETA preprod
  onboarding (serialisation test vectors, EGS item codes, signing requirement), the insurers' claim file formats, the ITQAN
  endpoint contract, and the speech-to-text endpoint.
- **pilot (R3)** The AI scribe has not been called against the live Claude API in this build; run the clinician-graded
  evaluation set (Egyptian Arabic dictations) and obtain counsel approval of the data-processing terms before enabling it.
- Support access shows patient demographics (not clinical records) inside the owner-approved window; confirm with counsel.
