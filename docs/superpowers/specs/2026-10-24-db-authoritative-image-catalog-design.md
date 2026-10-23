# Database-Authoritative Image Catalog Design

## Problem

Image routes and image models are managed in MySQL on the production server, but
the stores import any static catalog entries that are missing from their MySQL
tables during schema initialization. Deleting a route or model therefore causes
it to return after a later server restart or deployment.

## Decision

MySQL is authoritative after the first catalog initialization. Static JSON files
provide initial defaults only for a genuinely new, empty installation. Once a
catalog has been initialized, startup must not recreate entries removed from
MySQL. New routes and models introduced by later code releases are added through
the admin interface by an operator.

## Initialization and Migration

Persist initialization state in MySQL for the route and model catalogs. During
the first startup with the updated code:

- If a catalog table already contains rows, mark that catalog initialized
  without importing missing static entries. This preserves the current
  production configuration and any existing omissions.
- If a catalog is empty and has never been initialized, import its static
  defaults once, then mark it initialized.
- Once initialized, do not infer initialization from row count. An intentionally
  empty catalog must remain empty after restart.

Initialization and seeding must be transactional and idempotent so concurrent
application instances cannot duplicate seed rows or lose the marker.

## User-Visible Behavior

- Existing server configuration remains authoritative through deployments.
- Deleting a route or model remains effective after restart and update.
- Fresh installations still receive the repository's initial catalog.
- Future catalog additions require an explicit admin action.
- Entries already reinserted before this fix cannot be distinguished from
  intentional entries. The operator must delete those entries once more after
  deploying the fix.

## Scope

Change only image route/model initialization and focused tests. Runtime route
resolution, pricing, API keys, and generation behavior remain unchanged. Do not
read or modify server `.env` files.

## Validation

Tests must cover first-time seeding on an empty database, preserving existing
database contents on the first upgraded startup, retaining deletions across
subsequent startup calls including an empty table, and idempotent initialization.
