# ADR 0001: Build original code; use KiviCare only as a functional benchmark

- Status: accepted (BRD §1, §5)
- Date: 2026-11-16

## Context
The vendor review of KiviCare (base 4.5.6, Pro 4.4.4, Telemed 4.0.1, API 11.0.0, Flutter 11.0.0) found critical security defects,
weak Arabic/RTL support, India-oriented defaults and a WordPress architecture that cannot run on Vercel.

## Decision
Write the platform from scratch. The BRD §5 table is the scope benchmark; no KiviCare code, schema or assets are reused.

## Consequences
Full ownership of code, data model and roadmap. Feature parity is tracked in `docs/sprints.md` against BRD §5.
