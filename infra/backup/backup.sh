#!/usr/bin/env bash
# NFR-4: daily encrypted logical backup to a second region/provider.
# Requires: pg_dump, age, aws CLI. Env: DATABASE_ADMIN_URL, AGE_RECIPIENT, BACKUP_S3_URI, BACKUP_S3_ENDPOINT.
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="healthflow-${stamp}.dump.age"
pg_dump --format=custom --no-owner --dbname="$DATABASE_ADMIN_URL" | age -r "$AGE_RECIPIENT" > "/tmp/${file}"
sha256sum "/tmp/${file}" > "/tmp/${file}.sha256"
aws s3 cp "/tmp/${file}" "${BACKUP_S3_URI}/${file}" --endpoint-url "$BACKUP_S3_ENDPOINT"
aws s3 cp "/tmp/${file}.sha256" "${BACKUP_S3_URI}/${file}.sha256" --endpoint-url "$BACKUP_S3_ENDPOINT"
rm -f "/tmp/${file}" "/tmp/${file}.sha256"
echo "backup ${file} uploaded"
