const { closePool, isMySqlConfigured, withTransaction } = require('../db.cjs');
const { ensureVideoModelSchema } = require('../videoModelStore.cjs');
const { ensureVideoRouteSchema } = require('../videoRouteStore.cjs');
const { applyPixelHubVideoMigration } = require('../pixelhubVideoMigration.cjs');

const main = async () => {
  if (!isMySqlConfigured()) throw new Error('MySQL is not configured');
  await ensureVideoModelSchema();
  await ensureVideoRouteSchema();
  await withTransaction((connection) => applyPixelHubVideoMigration(connection));
  console.log('PixelHub video catalog migration complete.');
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closePool());
