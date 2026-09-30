const assert = require('assert');
const nodeTest = require('node:test');
const describe = globalThis.describe || nodeTest.describe;
const it = globalThis.it || nodeTest.it;
const {
  applyPixelHubVideoMigration,
  buildPixelHubVideoMigrationOperations,
} = require('./pixelhubVideoMigration.cjs');

describe('PixelHub video catalog migration', () => {
  it('upserts the full active catalog without requesting legacy deactivation', () => {
    const operations = buildPixelHubVideoMigrationOperations();
    assert.strictEqual(operations.models.length, 3);
    assert.strictEqual(operations.routes.length, 3);
    assert.strictEqual(operations.deactivateLegacyModels, false);
    assert.strictEqual(operations.deactivateLegacyRoutes, false);
    assert.strictEqual(operations.defaultModelId, 'gemini-omni-1.1-flash');
    assert.strictEqual(operations.defaultRouteId, 'gemini-omni-1.1-flash-line1');
    assert.strictEqual(operations.models.find((model) => model.id === 'gemini-omni-1.1-flash').isActive, true);
    assert.strictEqual(operations.models.find((model) => model.id === 'grok-imagine-video-1.5').isActive, true);
    assert.strictEqual(operations.routes.find((route) => route.id === 'gemini-omni-1.1-flash-line1').isActive, true);
    assert.strictEqual(operations.routes.find((route) => route.id === 'grok-imagine-video-1.5-mouxihub').isActive, true);
    assert.strictEqual(operations.models.find((model) => model.id === 'omni_flash-10s').selectorCost, 20);
    assert.strictEqual(operations.models[0].pricingMode, 'fixed');
    const omni = operations.routes.find((route) => route.id === 'omni_flash-10s-mouxihub');
    assert.strictEqual(omni.baseUrl, 'https://api.mouxihub.com');
    assert.strictEqual(omni.contentPath, undefined);
  });

  it('does not carry API keys in catalog operations', () => {
    const operations = buildPixelHubVideoMigrationOperations();
    assert.ok(operations.routes.every((route) => !Object.prototype.hasOwnProperty.call(route, 'apiKey')));
  });

  it('does not define operations for historical or billing tables', () => {
    const serialized = JSON.stringify(buildPixelHubVideoMigrationOperations());
    assert.ok(!serialized.includes('generation_records'));
    assert.ok(!serialized.includes('billing'));
    assert.ok(!serialized.includes('pending_tasks'));
  });

  it('keeps migration insert columns, placeholders, and parameters aligned', async () => {
    const statements = [];
    const connection = {
      execute: async (sql, params = []) => {
        statements.push({ sql, params });
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
    assert.ok(!statements.some(({ sql }) => /UPDATE video_(models|routes) SET is_active = 0/i.test(sql)));
    assert.ok(!statements.some(({ sql }) => /ON DUPLICATE KEY UPDATE[\s\S]*api_key\s*=/i.test(sql)));
  });
});
