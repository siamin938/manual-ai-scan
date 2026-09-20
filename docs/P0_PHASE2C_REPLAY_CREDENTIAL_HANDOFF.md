# Phase 2C Historical Replay — Read-Only Credential Handoff

Status: preparation only. This document does not authorize or perform a Production role change.

## Existing role

An existing login role is present:

`entity_v2_replay_reader_20260913`

Read-only inspection on 2026-09-19 found:

- login: enabled
- CONNECT: yes
- public schema USAGE: yes
- SELECT already granted:
  - public.measurement_runs
  - public.measurements
  - public.businesses
  - public.measurement_mentions
  - public.measurement_entity_canonicalizations
- SELECT missing:
  - public.questions
  - public.measurement_citation_attributions
- INSERT/UPDATE/DELETE on public.measurements: no
- role validity expired on 2026-09-13
- no replay credential was found in Supabase Vault
- GitHub Actions secret `ENTITY_V2_REPLAY_DATABASE_URL` is currently absent

The role has `BYPASSRLS`, which is required to replay historical org-scoped data across the intended corpus. Because of that capability, it must remain SELECT-only, time-limited, and used only by the replay workflow.

## Minimal Production authorization needed

Only after explicit approval, use the existing role rather than creating another role.

Required DB changes are intentionally minimal:

1. renew the role for a short window
2. reset its password to a new high-entropy one
3. set transaction read-only by default as defense in depth
4. grant SELECT only on the two newly required tables:
   - public.questions
   - public.measurement_citation_attributions

Conceptual SQL:

```sql
alter role entity_v2_replay_reader_20260913
  password '<new-high-entropy-password>'
  valid until '<short UTC expiry>';

alter role entity_v2_replay_reader_20260913
  set default_transaction_read_only = on;

grant select on public.questions
  to entity_v2_replay_reader_20260913;

grant select on public.measurement_citation_attributions
  to entity_v2_replay_reader_20260913;
```

Do not put the real password in Git, this document, issue/PR comments, logs, or chat.

Before use, verify the role still has no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges on replay tables.

## GitHub Actions secret

Repository secret name:

`ENTITY_V2_REPLAY_DATABASE_URL`

Value format:

```text
postgresql://entity_v2_replay_reader_20260913:<PASSWORD>@db.qoirkwmnyolquvsgbian.supabase.co:5432/postgres?sslmode=require
```

The actual password must be inserted only in GitHub Actions Secrets UI/API through a secure channel.

## Runtime defenses already in the workflow

The Phase 2C historical workflow also:

- requires the dedicated secret and aborts if absent
- starts an explicit read-only transaction
- sets a statement timeout
- uses a single DB connection
- runs only stored-data export; no provider/API AI calls
- writes replay output only to /tmp
- uploads a review artifact with one-day retention
- removes the local temporary replay file afterward

The export SQL has a read-only contract test and was also successfully checked against the live Production schema with PostgreSQL `EXPLAIN`.

## Corpus currently expected

Read-only discovery on 2026-09-19:

- 23 completed standalone audit runs
- 428 measurements
- 428 valid measurements
- 1,018 stored citation attribution rows
- 260 measurements with stored citation attribution

## After replay

Do not merge/cut over based only on workflow success.

Review:

- release gate blocking issues
- visibility bounds changes
- Top3 bounds changes
- unresolved target counts
- self-competitor checks
- source complete/partial status
- accepted source attribution and diagnostics
- regression businesses, especially 카스페이스 구로점

After the review window, let the role expire or explicitly expire/disable it and remove the GitHub Actions secret.
