#!/usr/bin/env bash
# Monthly restore drill (NFR-4): restore the latest backup into a scratch database and verify it.
# Env: AGE_IDENTITY_FILE, BACKUP_S3_URI, BACKUP_S3_ENDPOINT, DRILL_ADMIN_URL (server without the target DB).
set -euo pipefail
latest=$(aws s3 ls "${BACKUP_S3_URI}/" --endpoint-url "$BACKUP_S3_ENDPOINT" | awk '{print $4}' | grep '\.dump\.age$' | sort | tail -1)
aws s3 cp "${BACKUP_S3_URI}/${latest}" /tmp/latest.age --endpoint-url "$BACKUP_S3_ENDPOINT"
started=$(date +%s)
psql "$DRILL_ADMIN_URL" -c "drop database if exists restore_drill with (force)" -c "create database restore_drill"
age -d -i "$AGE_IDENTITY_FILE" /tmp/latest.age | pg_restore --no-owner --dbname="${DRILL_ADMIN_URL%/*}/restore_drill"
psql "${DRILL_ADMIN_URL%/*}/restore_drill" -At -c "select 'orgs', count(*) from organisations union all select 'patients', count(*) from patients union all select 'appointments', count(*) from appointments"
for org in $(psql "${DRILL_ADMIN_URL%/*}/restore_drill" -At -c "select id from organisations"); do
  broken=$(psql "${DRILL_ADMIN_URL%/*}/restore_drill" -At -c "select coalesce(audit_verify('$org')::text, 'intact')")
  echo "audit chain $org: $broken"
done
echo "restore drill of ${latest} completed in $(( $(date +%s) - started ))s (RTO target 4h)"
