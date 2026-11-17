# ETA e-receipts (FR-BIL-10)

- Credentials per legal entity (`PUT /v1/legal-entities/:id/eta`), AES-256-GCM encrypted: client id/secret, POS serial,
  POS OS version, pre-shared key, RIN, branch and activity codes, branch address; `preprod` or `prod`.
- When a bill becomes fully paid a B2C receipt is built (`buildEtaReceipt`), chained to the clinic's previous receipt UUID
  (`previousUUID`, serialised with an advisory lock) and its UUID is the SHA-256 of the canonical serialisation with an empty
  `uuid` (`etaSerialize`). The worker submits queued receipts every minute (`POST /api/v1/receiptsubmissions` after a
  client-credentials token with the POS headers), retrying with exponential backoff up to 8 attempts.
- Dashboard: `GET /v1/eta/receipts`; manual retry `POST /v1/eta/receipts/:id/retry`. The invoice/receipt PDF carries the
  ETA QR (share URL with total and issuer RIN) once the receipt is submitted.

**Confirm during ETA onboarding:** the canonical serialisation and UUID against the ETA SDK test vectors, the document
version (`typeVersion`), item coding (EGS codes registered for each service), activity code, and whether the
organisation's receipts must be signed (the adapter has no signing step; add one in `EtaService.enqueue` if required).
