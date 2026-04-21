const mysql = require("mysql2/promise");

const MYSQL_URL = String(process.env.MYSQL_URL || "").trim();
const MYSQL_HOST = String(process.env.MYSQL_HOST || "").trim();
const MYSQL_PORT = Number.parseInt(String(process.env.MYSQL_PORT || "3306"), 10);
const MYSQL_USER = String(process.env.MYSQL_USER || "").trim();
const MYSQL_PASSWORD = String(process.env.MYSQL_PASSWORD || "").trim();
const MYSQL_DATABASE = String(process.env.MYSQL_DATABASE || "").trim();
const MYSQL_CONNECTION_LIMIT = Number.parseInt(
  String(process.env.MYSQL_CONNECTION_LIMIT || "10"),
  10,
);

let poolPromise = null;

const isMySqlConfigured = () =>
  Boolean(MYSQL_URL) || Boolean(MYSQL_HOST && MYSQL_USER && MYSQL_DATABASE);

const toDbDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid date value for database storage");
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
};

const fromDbDateTime = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const text = String(value).trim();
  if (!text) return null;
  if (text.endsWith("Z")) return text;
  if (text.includes("T")) return `${text}Z`;
  return `${text.replace(" ", "T")}Z`;
};

const createPoolConfig = () => {
  if (MYSQL_URL) {
    return {
      uri: MYSQL_URL,
      waitForConnections: true,
      connectionLimit: Number.isFinite(MYSQL_CONNECTION_LIMIT) ? MYSQL_CONNECTION_LIMIT : 10,
      charset: "utf8mb4",
      timezone: "Z",
      dateStrings: true,
    };
  }

  return {
    host: MYSQL_HOST,
    port: Number.isFinite(MYSQL_PORT) ? MYSQL_PORT : 3306,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: Number.isFinite(MYSQL_CONNECTION_LIMIT) ? MYSQL_CONNECTION_LIMIT : 10,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
  };
};

const ensureDatabaseExists = async () => {
  if (!isMySqlConfigured() || MYSQL_URL || !MYSQL_DATABASE) return;

  const adminConnection = await mysql.createConnection({
    host: MYSQL_HOST,
    port: Number.isFinite(MYSQL_PORT) ? MYSQL_PORT : 3306,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
  });

  try {
    await adminConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await adminConnection.end();
  }
};

const getPool = async () => {
  if (!isMySqlConfigured()) {
    throw new Error("MySQL is not configured");
  }

  if (!poolPromise) {
    poolPromise = (async () => {
      await ensureDatabaseExists();
      return mysql.createPool(createPoolConfig());
    })();
  }

  return poolPromise;
};

const query = async (sql, params = []) => {
  const pool = await getPool();
  const [rows] = await pool.execute(sql, params);
  return rows;
};

const execute = async (sql, params = []) => {
  const pool = await getPool();
  const [result] = await pool.execute(sql, params);
  return result;
};

const withTransaction = async (runner) => {
  const pool = await getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await runner(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_rollbackError) {
      // Ignore rollback errors and surface the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
};

const closePool = async () => {
  if (!poolPromise) return;
  const pool = await poolPromise;
  await pool.end();
  poolPromise = null;
};

module.exports = {
  closePool,
  execute,
  fromDbDateTime,
  getPool,
  isMySqlConfigured,
  query,
  toDbDateTime,
  withTransaction,
};
