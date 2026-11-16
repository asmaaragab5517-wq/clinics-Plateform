# ADR 0002: Tenancy with PostgreSQL row-level security and tenant-bound foreign keys

- Status: accepted (SRS §3 MT-1..MT-5)

## Decision
- Every business table carries `organisation_id`; RLS is enabled on all of them. The application connects as `hf_api`
  (member of `hf_app`, `NOBYPASSRLS`, owns no table). Policies read transaction-local settings
  (`app.org_id`, `app.mode`, `app.network`, `app.clinic_ids`, `app.patient_ids`) set by `Database.withTenant`.
- Modes: `staff` (clinic-scoped unless network role), `patient` (own and confirmed family patients only),
  `public` (catalogue only), `system` (worker and webhooks, organisation-scoped).
- Plain foreign keys ignore RLS, so migration 0011 adds a composite `(organisation_id, fk)` foreign key for every
  foreign key between tenant tables. A row can never reference another organisation's entity.
- Pre-tenant lookups (resolve organisation, staff identity, prescription verification, slot counts) are narrow
  `SECURITY DEFINER` functions returning only the columns needed.
- The MT-5 suite (`apps/api/test/isolation.test.ts`) runs every route for every role against a foreign organisation and
  a same-organisation sibling patient; it blocks merge.

## Consequences
Isolation does not depend on every query remembering a `where organisation_id = …`. Application checks (privileges,
ownership, clinic membership) remain the first line; RLS and tenant FKs are the backstop.
