# ADR 0007: AI assistance is draft-only, doctor-approved and PHI-minimised

- Status: accepted (BR-19, FR-EMR-9, R3)

## Decision
- Three tasks: encounter note from dictation (typed text or audio), patient-friendly Arabic/English visit summary,
  prescription instruction wording. Model `claude-opus-5-5` via the Anthropic SDK with structured outputs (zod schemas),
  effort `medium`, server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), refusal handling.
- Every result is stored as an `ai_drafts` row (`pending`). Only `POST /v1/ai/drafts/:id/approve`, called by the treating
  doctor with the final values, writes to the record; signed encounters and issued prescriptions are never changed.
  Drafts expire after 24 hours. No autonomous clinical decisions.
- PHI minimisation: patient name parts, phone numbers, national IDs and e-mails are removed before sending; only age, sex,
  specialty and clinical content leave the platform. Transcripts are stored encrypted.
- Validation: ICD-10 suggestions not in the catalogue and out-of-range vitals become warnings and are dropped from the
  draft; prescription wording is checked to keep the duration.
- Governance: organisation switch (`feature_flags.ai_assistance`, owner/settings privilege), every draft/approval/rejection
  audited with model, served model (after fallback) and prompt version, token usage report.
- Audio transcription uses a configurable OpenAI-compatible `/audio/transcriptions` endpoint so audio can stay in-region (D1).

## Open items
- Run the R3 evaluation set (clinician-graded dictations in Egyptian Arabic) before enabling in production.
- Data-processing terms for sending clinical text to the model provider must be approved by counsel (PDPL).
