# Threat model and controls (SEC-1..SEC-11)

| Threat | Control | Evidence |
|---|---|---|
| Cross-tenant / cross-patient access (IDOR) | Deny-by-default guard, privilege matrix, RLS on every table, tenant-bound FKs, patient-mode RLS | `packages/db/test/rls.test.ts`, `apps/api/test/isolation.test.ts` |
| Privilege escalation | Only owners grant owner/director roles; privilege edits audited; four-eyes on refunds and approvals | `staff.ts`, `billing.ts` |
| OTP brute force | 6 digits, 5 min, 3 attempts, resend 60 s, 5/phone/h, 20/IP/h, HMAC-peppered hashes | `auth.ts`, e2e test |
| Token theft | Patient access JWT 15 min, rotating refresh with family revocation on reuse; web tokens only in httpOnly SameSite=Strict cookies; mobile in Keychain/Keystore | `auth.ts`, BFF route handlers |
| Webhook forgery / replay | HMAC signatures with timestamp tolerance, idempotent processing | `payments.ts`, e2e test |
| SSRF | No server-side fetching of user URLs (imports reject image URLs; PDF renderer blocks all non-data requests) | `imports.ts`, `documents/render.ts` |
| Malicious uploads | Magic-byte MIME sniffing, 25 MB limit, ClamAV, private bucket, 5-minute signed URLs | `storage.ts`, `emr.ts` |
| CSV/Excel injection in exports | Cells starting with `= + - @` are prefixed | `reports.ts` |
| Data tampering of audit trail | Append-only trigger, per-org SHA-256 hash chain, nightly verification | `0003_functions.sql`, worker |
| Secrets exposure | AES-256-GCM field encryption (NID, passport, signature refs, merchant keys); no provider secret in clients; gitleaks in CI; production refuses dev settings | `crypto.ts`, `config.ts` |
| PHI in logs | Error filter never echoes SQL/PHI; messaging logs never include bodies; observability must scrub | `errors.ts`, `messaging.ts` |

| SSRF via admin-configured webhooks | https only, public addresses only (re-checked at send time), no redirects, no custom ports | `integrations/egress.ts`, R2 test |
| OAuth CSRF / code injection | Signed, expiring, single-use state bound to the user | `modules/telemedicine.ts`, R2 test |
| PHI leaving the platform (AI, ITQAN) | Name/phone/ID/e-mail removal, pseudonymous patient refs only with consent, encrypted transcripts | `modules/ai.ts`, `modules/events.ts` |
| AI output written to the record | Draft-only, doctor approval with explicit values, validation warnings, audit with model and prompt version | ADR 0007 |
| Vendor support access | Owner-approved, time-boxed, read-only, no EMR, revocable, audited as `support` | `modules/platform.ts` |
| API key leakage | SHA-256 stored, shown once, scoped, expiring, revocable, rate-limited, no patient names in responses | `modules/platform.ts` |

External penetration test is required before R1 go-live and annually (SEC-9).
