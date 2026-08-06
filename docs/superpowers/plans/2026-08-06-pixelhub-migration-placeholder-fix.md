# PixelHub Migration Placeholder Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PixelHub catalog migration execute successfully by keeping every insert's columns, placeholders, and bound values aligned.

**Architecture:** Keep the existing transactional migration and static catalog unchanged. Add a structural regression test around the real migration function, then remove the two extra placeholders from the `video_models` insert.

**Tech Stack:** Node.js CommonJS, MySQL parameterized SQL, Vitest with Node `assert`.

---

## File Structure

- Modify `pixelhubVideoMigration.test.cjs`: validate the SQL shape produced by the real migration function.
- Modify `pixelhubVideoMigration.cjs`: correct the `video_models` placeholder list only.

### Task 1: Reproduce The Invalid Insert Shape

**Files:**
- Test: `pixelhubVideoMigration.test.cjs`

- [ ] **Step 1: Import the real migration function and add the validating connection test**

Update the import and add this test:

```js
const {
  applyPixelHubVideoMigration,
  buildPixelHubVideoMigrationOperations,
} = require('./pixelhubVideoMigration.cjs');

it('keeps migration insert columns, placeholders, and parameters aligned', async () => {
  const connection = {
    execute: async (sql, params = []) => {
      if (!/^\s*INSERT INTO\s+/i.test(sql)) return [{}];
      const match = sql.match(/^\s*INSERT INTO\s+\w+\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i);
      assert.ok(match, 'expected a parameterized INSERT statement');
      const columnCount = match[1].split(',').map((value) => value.trim()).filter(Boolean).length;
      const placeholderCount = (match[2].match(/\?/g) || []).length;
      assert.strictEqual(placeholderCount, columnCount, 'placeholder count must match column count');
      assert.strictEqual(params.length, columnCount, 'parameter count must match column count');
      return [{}];
    },
  };

  await applyPixelHubVideoMigration(connection);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest --run pixelhubVideoMigration.test.cjs
```

Expected: FAIL with `placeholder count must match column count`, showing `31 !== 29`.

### Task 2: Correct The Video Model Insert

**Files:**
- Modify: `pixelhubVideoMigration.cjs`
- Test: `pixelhubVideoMigration.test.cjs`

- [ ] **Step 1: Remove the two surplus placeholders**

Change the `video_models` values clause from 31 placeholders to exactly 29 placeholders:

```sql
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Do not modify its 29 columns, 29 bound parameters, `ON DUPLICATE KEY UPDATE` clause, route insert, or transaction behavior.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
npx vitest --run pixelhubVideoMigration.test.cjs
```

Expected: all PixelHub migration tests pass.

- [ ] **Step 3: Commit the implementation**

```bash
git add pixelhubVideoMigration.cjs pixelhubVideoMigration.test.cjs
git commit -m "fix: align PixelHub migration placeholders"
```

### Task 3: Verify And Publish

**Files:**
- Verify only; no additional file changes.

- [ ] **Step 1: Run the complete automated test suite**

```bash
npm test
```

Expected: zero failed tests.

- [ ] **Step 2: Run backend syntax checks and frontend type/build checks**

```bash
node --check pixelhubVideoMigration.cjs
node --check scripts/activate-pixelhub-video-models.cjs
npx tsc --noEmit
npm run build
git diff --check
```

Expected: every command exits successfully; Vite may report existing bundle-size warnings but no build failure.

- [ ] **Step 3: Push `main`**

```bash
git push origin main
```

Expected: remote `main` advances to the implementation commit.

- [ ] **Step 4: Deploy and rerun the migration on the server**

```bash
cd /www/wwwroot/aigc.aittco.com
git pull --ff-only origin main
docker compose up -d --build app
docker compose exec -T app npm run migrate:pixelhub-video
docker compose restart app
```

Expected migration output:

```text
PixelHub video catalog migration complete.
```

- [ ] **Step 5: Verify the production catalogs**

```bash
curl -sS https://aigc.aittco.com/api/video-models/catalog
curl -sS https://aigc.aittco.com/api/video-routes/catalog
```

Expected: only `gemini-omni-flash`, `sora-v3-pro`, and `veo31-fast` are active, with one matching active route per model.
