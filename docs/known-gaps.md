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
- Doctor search lacks "next available date" and city filters (FR-WEB-2 partly met); clinic page has no doctor photos (no public image URL yet).
- Abandoned booking tracking (FR-WEB-3) is not recorded server-side.
- Idempotency keys are honoured for bookings, walk-ins and payments; check-in and queue updates rely on state-machine conflicts.
- Console: waitlist UI, custom-field definitions UI, encounter-template authoring, prescription revoke button, tablet signature capture for re-consent.
- Body chart stores vector shapes only (no rendered PNG yet).
- Mobile: live queue uses polling (SSE in web), screenshot blocking is app-wide on Android only, root/jailbreak warning not implemented, certificate pins must be supplied (`CERT_PINS`).
- Site BFF refresh de-duplication is per instance.
- R2/R3 scope (telemedicine, ETA e-receipt, insurance, Google Calendar, ITQAN feed, AI scribe, SaaS admin) not started.
