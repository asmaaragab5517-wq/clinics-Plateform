# Known gaps and follow-ups (end of Sprint 7)

Collected from the build and the front-end integration reviews. None blocks the R1 pilot build; items marked **pilot**
must be closed before go-live.

## Needs external input
- **pilot** HealthPay and Cequens endpoint contracts are assumptions (`docs/integrations`); confirm with each provider.
- **pilot** Licensed Egyptian drug list (D10) and full ICD-10 with Arabic titles; clinician sign-off on `docs/glossary.ar.md` and templates.
- **pilot** Legal texts for consents/privacy/terms (counsel); PDPL hosting opinion (D1).
- **pilot** External penetration test; Lighthouse/axe runs and RTL screenshot approval on staging; k6 run on staging.
- **pilot** Apple/Google organisation accounts for TestFlight/Play closed testing; app icon and splash.
- Docker image build was not exercised in the development sandbox (no registry access); the CI `image` job is the first real build.

## Product/API
- Sprint 16 follow-ups: patients cannot add/update insurance coverage from the portal (staff-entered only); portal appointments have no video-visit flag and patients cannot book video visits; the doctor's video list lacks patient/encounter ids; no endpoint to re-open a pending AI draft; push tokens stay registered after a session expires.
- Mobile dictation recordings stay in the app's private cache after upload (deleting needs expo-file-system). Dictation, notification taps and payment return are not yet tested on a device.
- Public catalogue cache is per process: after a write, other replicas can serve catalogue data up to `PUBLIC_CACHE_SECONDS` (60 s) old and slots up to 5 s old. Booking stays correct because the database exclusion constraint decides. Move the cache to Redis if staff need instant consistency across replicas.
- Uncached public reads cost ~2–14 ms CPU each; the sandbox load test saturates one Node process at ~260 req/s, so size replicas from the staging k6 run.
- Idempotency keys are honoured for bookings, walk-ins and payments; check-in and queue updates rely on state-machine conflicts.
- Console: waitlist UI, custom-field definitions UI, encounter-template authoring, prescription revoke button, tablet signature capture for re-consent.
- Mobile: in-app audio dictation pending (Sprint 16); live queue uses polling (SSE in web), screenshot blocking is app-wide on Android only, root/jailbreak warning not implemented, certificate pins must be supplied (`CERT_PINS`).
- Site BFF refresh de-duplication is per instance.
- R2/R3 integrations are built against fakes; each needs a real-account check: Zoom/Google OAuth apps, ETA preprod
  onboarding (serialisation test vectors, EGS item codes, signing requirement), the insurers' claim file formats, the ITQAN
  endpoint contract, and the speech-to-text endpoint.
- **pilot (R3)** The AI scribe has not been called against the live Claude API in this build; run the clinician-graded
  evaluation set (Egyptian Arabic dictations) and obtain counsel approval of the data-processing terms before enabling it.
- Support access shows patient demographics (not clinical records) inside the owner-approved window; confirm with counsel.
