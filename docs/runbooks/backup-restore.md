# Backup and restore (NFR-4)

- Managed PostgreSQL PITR: RPO ≤ 15 min (provider continuous WAL archiving).
- Daily logical backup to a second provider: `infra/backup/backup.sh` (pg_dump → age encryption → S3), scheduled by
  `.github/workflows/backup.yml`.
- Monthly restore drill: `infra/backup/restore-drill.sh` restores into a scratch database, prints row counts, verifies
  every organisation's audit hash chain and the elapsed time (RTO target 4 h). The log is kept as a workflow artifact
  for 400 days as evidence.
- Keys: the age identity lives only in the `production` environment secrets and an offline copy held by the owner.
