import { parentPort, workerData } from 'node:worker_threads';
import pg from 'pg';
import { postgresConnectionOptions } from './postgres-tls.js';

pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));
const encoder = new TextEncoder();
let client = null;
let transaction = false;
let brokenTransaction = false;
let retainedResult = null;
let queue = Promise.resolve();

function cleanError(error) {
  const codes = { '23505': 'SQLITE_CONSTRAINT_UNIQUE', '23503': 'SQLITE_CONSTRAINT_FOREIGNKEY', '23502': 'SQLITE_CONSTRAINT_NOTNULL' };
  return { name: error.name || 'Error', message: error.message || 'PostgreSQL operation failed',
    code: codes[error.code] || error.code || 'DATABASE_ERROR', postgresCode: error.code,
    constraint: error.constraint };
}

async function connect() {
  if (client) return;
  const connection = new pg.Client({
    ...postgresConnectionOptions(workerData.connectionString, workerData.ssl),
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
    keepAlive: true,
    application_name: 'petezah-ad-free',
  });
  connection.on('error', () => {
    if (transaction) brokenTransaction = true;
    if (client === connection) client = null;
  });
  try {
    await connection.connect();
    await connection.query(`SET search_path TO "${workerData.schema}", pg_catalog`);
    client = connection;
  } catch (error) {
    await connection.end().catch(() => {});
    throw error;
  }
}

async function execute(message) {
  if (message.operation === 'connect') { await connect(); return {}; }
  if (message.operation === 'close') { if (client) await client.end(); client = null; return {}; }
  if (brokenTransaction) {
    if (/^\s*ROLLBACK\b/i.test(message.text)) {
      transaction = false;
      brokenTransaction = false;
      return {};
    }
    throw new Error('PostgreSQL transaction lost its connection and must be rolled back');
  }
  await connect();
  let result;
  try {
    result = await client.query(message.text, message.values?.length ? message.values : undefined);
  } catch (error) {
    if (['08000', '08003', '08006', '57P01', '57P02', '57P03', 'ECONNRESET', 'EPIPE'].includes(error.code) || !client) {
      if (transaction) brokenTransaction = true;
      const oldClient = client;
      client = null;
      await oldClient?.end().catch(() => {});
    }
    throw error;
  }
  if (/^\s*BEGIN\b/i.test(message.text)) transaction = true;
  if (/^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(message.text)) transaction = false;
  if (Array.isArray(result)) result = result.at(-1);
  const rows = result?.rows || [];
  if (message.mode === 'get') return rows[0] ?? null;
  if (message.mode === 'all') return rows;
  return { changes: result?.rowCount || 0, lastInsertRowid: rows[0]?.id ?? 0 };
}

function respond(shared, result, isError = false) {
  const state = new Int32Array(shared, 0, 4);
  const encoded = encoder.encode(JSON.stringify(result));
  Atomics.store(state, 1, encoded.byteLength);
  if (encoded.byteLength > shared.byteLength - 16) {
    retainedResult = { result, isError };
    Atomics.store(state, 0, 2);
  } else {
    new Uint8Array(shared, 16, encoded.byteLength).set(encoded);
    Atomics.store(state, 0, isError ? -1 : 1);
  }
  Atomics.notify(state, 0);
}

parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    try {
      if (message.operation === 'retrieve-result') {
        if (!retainedResult) throw new Error('Database result is unavailable');
        const previous = retainedResult;
        retainedResult = null;
        respond(message.shared, previous.result, previous.isError);
      } else if (message.operation === 'discard-result') {
        retainedResult = null;
        respond(message.shared, {});
      } else respond(message.shared, await execute(message));
    } catch (error) { respond(message.shared, cleanError(error), true); }
  });
});
