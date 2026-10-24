const assert = require('node:assert/strict');
const test = require('node:test');
const { initializeCatalogOnce } = require('./imageCatalogInitialization.cjs');

const createConnection = ({ initialCount = 0, markerExists = false } = {}) => {
  const state = { count: initialCount, markerExists, insertedRows: 0, initialized: false };
  return {
    state,
    async execute(sql, params) {
      if (sql.includes('INSERT IGNORE INTO image_catalog_initialization')) {
        if (state.markerExists) return [{ affectedRows: 0 }];
        state.markerExists = true;
        state.catalogName = params[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM image_routes')) {
        return [[{ total: state.count }]];
      }
      if (sql.includes('UPDATE image_catalog_initialization')) {
        state.initialized = true;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
};

test('an empty catalog imports defaults once and retains deletion after initialization', async () => {
  const connection = createConnection();
  let seedCount = 0;

  await initializeCatalogOnce(connection, {
    catalogName: 'image-routes',
    countSql: 'SELECT COUNT(*) AS total FROM image_routes',
    seed: async () => {
      seedCount += 1;
      connection.state.count = 3;
    },
  });
  connection.state.count = 0;

  await initializeCatalogOnce(connection, {
    catalogName: 'image-routes',
    countSql: 'SELECT COUNT(*) AS total FROM image_routes',
    seed: async () => { seedCount += 1; },
  });

  assert.equal(seedCount, 1);
  assert.equal(connection.state.initialized, true);
  assert.equal(connection.state.count, 0);
});

test('an existing catalog is marked initialized without importing missing defaults', async () => {
  const connection = createConnection({ initialCount: 4 });
  let seedCount = 0;

  await initializeCatalogOnce(connection, {
    catalogName: 'image-models',
    countSql: 'SELECT COUNT(*) AS total FROM image_routes',
    seed: async () => { seedCount += 1; },
  });

  assert.equal(seedCount, 0);
  assert.equal(connection.state.initialized, true);
});

test('an existing initialization marker prevents another application instance from seeding', async () => {
  const connection = createConnection({ markerExists: true });
  let seedCount = 0;

  await initializeCatalogOnce(connection, {
    catalogName: 'image-routes',
    countSql: 'SELECT COUNT(*) AS total FROM image_routes',
    seed: async () => { seedCount += 1; },
  });

  assert.equal(seedCount, 0);
  assert.equal(connection.state.initialized, false);
});
