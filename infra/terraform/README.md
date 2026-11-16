# Infrastructure (Terraform)

Creates one environment (`staging` or `production`) on DigitalOcean (decision D1 default: `fra1`) plus the two Vercel projects.

| Resource | Purpose |
|---|---|
| VPC | Private network for the database, cache and app |
| Managed PostgreSQL 16 (2 nodes) + read replica | Primary with standby; PITR is built in (RPO ≤ 15 min); replica serves reports |
| Managed Valkey | BullMQ queues, rate limits, SSE fan-out |
| Spaces bucket (private, versioned) | Documents, signatures, exports — only short-lived signed URLs |
| App Platform app | `api` service, `worker`, `clamav`, and a pre-deploy `migrate` job |
| Vercel projects | `site` and `console`, region `fra1`, `API_URL` pointing at the API |

```bash
terraform init -backend-config="bucket=healthflow-tfstate" -backend-config="key=staging.tfstate" \
  -backend-config="endpoint=https://fra1.digitaloceanspaces.com" -backend-config="region=us-east-1" \
  -backend-config="skip_credentials_validation=true" -backend-config="skip_region_validation=true"
terraform plan -var-file=staging.tfvars
```

Relocation (D1): set `region` (or swap the provider module for an Egyptian host) and restore the latest encrypted
logical backup (`infra/backup`). Nothing in the application depends on DigitalOcean-specific APIs: it needs
PostgreSQL 16, a Redis-compatible store and an S3-compatible bucket (NFR-10).
