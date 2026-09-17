# SEC-201 — Deployment gate parity

## Problem

SEC-200 added `gps-timestamp-tie:check` to CI, but the two STAGE deployment workflows did not yet require it. A future manual/automatic deployment could therefore run a narrower safety gate set than pull-request validation.

## Control

Both deployment paths now require the same ingest-ordering protections:

- `heartbeat-ordering:check`;
- `asset-position-ordering:check`;
- `gps-timestamp-tie:check`.

A new `deploy-gate-parity:check` reads both workflow files and fails if any of those ingest safety gates disappears from either Pages STAGE or API STAGE.

The parity gate also preserves the invariant that repository privacy is checked before deployment credentials.

## Scope

This change is CI/CD-only. It does not alter DEV, STAGE, PROD, databases, credentials or Cloudflare resources. The repository remains public by current project decision, so both deployment workflows continue to fail closed at `Require private repository` before secrets are read.
