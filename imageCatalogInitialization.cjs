const INITIALIZATION_TABLE = 'image_catalog_initialization';

const ensureCatalogInitializationSchema = async (pool) => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${INITIALIZATION_TABLE} (
      catalog_name VARCHAR(64) PRIMARY KEY,
      initialized_at DATETIME(3) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
};

const initializeCatalogOnce = async (
  connection,
  { catalogName, countSql, seed },
) => {
  const [claim] = await connection.execute(
    `INSERT IGNORE INTO ${INITIALIZATION_TABLE} (catalog_name) VALUES (?)`,
    [catalogName],
  );
  if (Number(claim?.affectedRows || 0) !== 1) return false;

  const [countRows] = await connection.execute(countSql);
  if (Number(countRows?.[0]?.total || 0) === 0) await seed();

  await connection.execute(
    `UPDATE ${INITIALIZATION_TABLE} SET initialized_at = UTC_TIMESTAMP(3) WHERE catalog_name = ?`,
    [catalogName],
  );
  return true;
};

module.exports = {
  ensureCatalogInitializationSchema,
  initializeCatalogOnce,
};
