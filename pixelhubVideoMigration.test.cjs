const assert = require('assert');
const {
  applyPixelHubVideoMigration,
  buildPixelHubVideoMigrationOperations,
} = require('./pixelhubVideoMigration.cjs');

describe('PixelHub video catalog migration', () => {
  it('deactivates legacy catalog entries and upserts one target', () => {
    const operations = buildPixelHubVideoMigrationOperations();
    assert.strictEqual(operations.models.length, 1);
    assert.strictEqual(operations.routes.length, 1);
    assert.strictEqual(operations.deactivateLegacyModels, true);
    assert.strictEqual(operations.deactivateLegacyRoutes, true);
    assert.strictEqual(operations.defaultModelId, 'gemini-omni-1.1-flash');
    assert.strictEqual(operations.defaultRouteId, 'gemini-omni-1.1-flash-line1');
    assert.strictEqual(operations.models[0].selectorCost, 20);
    assert.strictEqual(operations.models[0].pricingMode, 'fixed');
    assert.strictEqual(operations.routes[0].baseUrl, 'https://rolldek.com');
    assert.strictEqual(operations.routes[0].contentPath, '/v1/videos/{taskId}/content');
  });

  it('clears direct database keys for all target routes', () => {
    const operations = buildPixelHubVideoMigrationOperations();
    assert.deepStrictEqual(operations.routes.map((route) => route.apiKey), [null]);
  });

  it('does not define operations for historical or billing tables', () => {
    const serialized = JSON.stringify(buildPixelHubVideoMigrationOperations());
    assert.ok(!serialized.includes('generation_records'));
    assert.ok(!serialized.includes('billing'));
    assert.ok(!serialized.includes('pending_tasks'));
  });

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
});
