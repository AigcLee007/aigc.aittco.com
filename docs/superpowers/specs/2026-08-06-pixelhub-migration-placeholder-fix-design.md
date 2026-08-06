# PixelHub Migration Placeholder Fix Design

## Problem

The production PixelHub catalog migration fails with MySQL error `Column count doesn't match value count at row 1`. The `video_models` insert declares 29 columns but contains 31 placeholders. MySQL rejects the first model upsert and the surrounding transaction rolls back, leaving legacy models and routes active.

## Scope

- Correct the `video_models` insert so its placeholder count matches its 29 columns and 29 bound values.
- Add a regression test that validates column, placeholder, and bound-value counts for both migration inserts.
- Preserve the existing transaction, catalog definitions, database schema, billing data, generation history, and route secrets.

## Data Flow

The deployment command runs `scripts/activate-pixelhub-video-models.cjs`, which opens a MySQL transaction and calls `applyPixelHubVideoMigration`. The migration first disables legacy video catalog rows, then upserts the three target models and routes. Any SQL error rolls back the entire transaction.

## Error Handling

The command continues to exit nonzero and print the database error when migration fails. A successful run prints `PixelHub video catalog migration complete.` No partial catalog state should be committed.

## Testing

The regression test uses a validating fake database connection to execute the real migration function. For each `INSERT`, it verifies that the number of declared columns, SQL placeholders, and supplied parameters are equal. The existing catalog and transaction tests remain unchanged.

## Deployment Verification

After deploying the fix, rerun `npm run migrate:pixelhub-video` inside the app container. The public model and route catalog endpoints must expose only `gemini-omni-flash`, `sora-v3-pro`, and `veo31-fast` as active entries.
