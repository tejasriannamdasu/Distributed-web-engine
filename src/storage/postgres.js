const { Pool } = require("pg");
const config = require("../../config");

let pool = null;

const getPool = () => {
  if (!pool) {
    pool = new Pool(config.pg);
    pool.on("error", (err) => console.error("PG pool error:", err.message));
  }
  return pool;
};

const query = async (text, params) => {
  try {
    const result = await getPool().query(text, params);
    return result;
  } catch (err) {
    console.error("PG query error:", err.message);
    throw err;
  }
};

const withTransaction = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const bulkInsert = async (table, columns, rows) => {
  if (!rows.length) return;
  const BATCH = config.storage.batchSize;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const values = [];
    const flat = [];
    slice.forEach((row, ri) => {
      const placeholders = columns.map((_, ci) => "$" + (ri * columns.length + ci + 1));
      values.push("(" + placeholders.join(", ") + ")");
      flat.push(...row);
    });
    await query(
      "INSERT INTO " + table + " (" + columns.join(", ") + ") VALUES " + values.join(", ") + " ON CONFLICT DO NOTHING",
      flat
    );
  }
};

const close = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("PG pool closed");
  }
};

module.exports = { getPool, query, withTransaction, bulkInsert, close };
