# Personal data breach procedure (PDPL, FR-PRV-5)

1. Detect/report → register immediately in Console › Privacy › Breaches (`POST /v1/privacy/breaches`). The response
   shows the PDPC notification deadline (detection + 72 h).
2. Contain: revoke access (deactivate staff, rotate secrets, disable integrations). Record `containedAt`.
3. Assess: affected patients via the audit log (`GET /v1/audit?patientId=` / by actor) and scope.
4. Notify PDPC within 72 h (`reportedToPdpcAt`); notify data subjects when required (`subjectsNotifiedAt`) using the
   approved Arabic template from counsel.
5. Post-incident review: root cause, fixes, update this runbook. Every step is appended to the breach timeline.
