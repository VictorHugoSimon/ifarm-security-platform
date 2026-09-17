# SEC-200 — Deterministic GPS timestamp ties

## Risk

After SEC-199, GPS ingestion for one asset is serialized. However, the legacy asset-position ordering rule still treated `recorded_at == last_position_at` as current because it used `>=`.

Two different events with the same device timestamp have no reliable temporal order. Allowing the second arrival to replace current location/geofence state would make operational state depend on network arrival order and could create arbitrary geofence transitions.

## Control

Migration `0033_gps_timestamp_tie_safety.sql` changes only the ordering comparison inside `ingest_asset_position_legacy_impl` from:

`p_recorded_at >= v_last_position`

to:

`p_recorded_at > v_last_position`

Therefore:

- strictly newer GPS observations may update current asset state;
- older observations remain historical;
- equal-timestamp observations also remain historical;
- every accepted observation is still retained in `asset_positions`;
- SEC-199 per-asset serialization remains in force;
- replay/idempotency and `event_id_conflict` semantics remain unchanged;
- browser roles still cannot execute the ingest RPC.

The migration inspects the actual prior function definition and aborts if the expected old comparison is not present. It is idempotent if the strict comparison has already been installed.

## Validation evidence — 2026-09-17

### DEV

Migration `0033` applied successfully. Live `pg_get_functiondef` validation returned:

- strict `p_recorded_at > v_last_position`: present;
- old `p_recorded_at >= v_last_position`: absent.

### STAGE

The same migration applied successfully and returned the same live validation:

- strict comparison: present;
- old non-strict comparison: absent.

STAGE currently has no persisted Asset/GPS fixture. No artificial device credential or synthetic asset was created solely to force an end-to-end test; this avoids expanding the credential surface for test convenience. Static CI verifies the migration contract and live DB inspection verifies the resulting function definition.

## Promotion status

DEV: validated.

STAGE: validated.

PROD: intentionally untouched. Promotion remains a separate gated decision.
