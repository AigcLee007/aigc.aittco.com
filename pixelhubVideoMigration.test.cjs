const assert = require('assert');
const { buildPixelHubVideoMigrationOperations } = require('./pixelhubVideoMigration.cjs');

describe('PixelHub video catalog migration', () => {
  it('deactivates legacy catalog entries and upserts only three targets', () => {
    const operations = buildPixelHubVideoMigrationOperations();
    assert.strictEqual(operations.models.length, 3);
    assert.strictEqual(operations.routes.length, 3);
    assert.strictEqual(operations.deactivateLegacyModels, true);
    assert.strictEqual(operations.deactivateLegacyRoutes, true);
    assert.strictEqual(operations.defaultModelId, 'gemini-omni-flash');
    assert.strictEqual(operations.defaultRouteId, 'gemini-omni-flash-line1');
  });

  it('clears direct database keys for all target routes', () => {
    const operations = buildPixelHubVideoMigrationOperations();
    assert.deepStrictEqual(operations.routes.map((route) => route.apiKey), [null, null, null]);
  });

  it('does not define operations for historical or billing tables', () => {
    const serialized = JSON.stringify(buildPixelHubVideoMigrationOperations());
    assert.ok(!serialized.includes('generation_records'));
    assert.ok(!serialized.includes('billing'));
    assert.ok(!serialized.includes('pending_tasks'));
  });
});
