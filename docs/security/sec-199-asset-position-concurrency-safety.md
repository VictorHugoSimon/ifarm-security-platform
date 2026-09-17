# SEC-199 — Asset position concurrency safety

## Risk

Rural gateways can buffer GPS positions and flush several requests at nearly the same time. The existing ordering rule stores historical positions and avoids updating current state when `recorded_at` is older than `last_position_at`, but two concurrent transactions could read the same previous value before either updates it.

That race could allow an older request to overwrite `assets.location`, `last_position_at` or `geofence_state` after a newer request.

## Control

`ingest_asset_position()` now acquires a transaction-scoped PostgreSQL advisory lock in a dedicated iFarm Security namespace and keyed by `asset_id` before calling the existing ingest implementation.

Consequences:

- only GPS writes for the same asset are serialized;
- different assets remain concurrent;
- buffered/out-of-order positions are still stored in `asset_positions`;
- older positions continue to return `historical` and cannot regress current asset state;
- duplicate event IDs remain idempotent;
- conflicting reuse of an event ID still raises `event_id_conflict`;
- the RPC remains server-side only and is not executable by portal roles.

The lock is transaction-scoped, so it is released automatically on commit/rollback and does not create a persistent application lock.

## Validation evidence

Validated on 2026-09-17 in the dedicated iFarm Security Neon project.

### DEV

- migration `0032_asset_position_concurrency_safety.sql` applied successfully;
- function definition contains `pg_advisory_xact_lock`;
- lock namespace `ifarm_security_asset_position` confirmed;
- `authenticated` EXECUTE = false;
- `anonymous` EXECUTE = false.

### STAGE

- the same migration applied successfully;
- per-asset advisory lock confirmed in the live function definition;
- dedicated lock namespace confirmed;
- `authenticated` EXECUTE = false;
- `anonymous` EXECUTE = false.

The CI gate also verifies that duplicate/idempotency conflict behavior remains present and that no browser role receives EXECUTE.

## Promotion status

DEV: validated.

STAGE: validated.

PROD: intentionally untouched. Promotion to PROD remains a separate gated decision.
