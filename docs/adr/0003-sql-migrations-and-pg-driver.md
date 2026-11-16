# ADR 0003: SQL migrations and the `pg` driver instead of Prisma

- Status: accepted (deviation from SRS §2.1 "Prisma + SQL migrations")

## Context
RLS needs per-transaction `set_config` calls, exclusion constraints, `SECURITY DEFINER` functions, materialised views and
composite tenant foreign keys. Prisma would still need raw SQL for all of these and adds generated engine binaries
to every container.

## Decision
Hand-written, ordered SQL migrations (`packages/db/migrations`) applied by a small runner under an advisory lock, and
the `pg` driver through `Database.withTenant()`, which always runs inside a transaction with RLS context set.

## Consequences
Queries are explicit SQL with typed row interfaces. Schema review happens in SQL, which is also what the RLS policies are
written in. Revisit if a typed query builder (e.g. Kysely) is wanted later; it can sit on the same `Tx`.
