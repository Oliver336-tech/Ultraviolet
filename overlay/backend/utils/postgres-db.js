import { Worker } from 'node:worker_threads';
import { translateSql } from './postgres-sql.js';

const decoder = new TextDecoder();
const initialResultSize = 1024 * 1024;
const maxResultSize = 64 * 1024 * 1024;

/** Keep the existing synchronous SQLite API while PostgreSQL I/O runs in a worker. */
export default class PostgresDatabase {
  constructor(connectionString, options = {}) {
    this.schema = options.schema || process.env.DATABASE_SCHEMA || 'petezah';
    if (!/^[a-z_][a-z0-9_]*$/.test(this.schema)) throw new Error('Invalid PostgreSQL application schema');
    this.timeout = options.timeout || 25000;
    this.name = 'postgresql';
    this.open = true;
    this.inTransaction = false;
    this._depth = 0;
    this._fatal = null;
    this._buffer = new SharedArrayBuffer(initialResultSize + 16);
    this._worker = new Worker(new URL('./postgres-worker.js', import.meta.url), {
      workerData: { connectionString, schema: this.schema, ssl: options.ssl ?? process.env.DATABASE_SSL !== 'disable' },
    });
    this._worker.unref();
    this._worker.on('error', (error) => { this._fatal = error; });
    this._worker.on('exit', (code) => {
      if (this.open && !this._fatal) this._fatal = new Error(`Database worker exited (${code})`);
    });
    this._request({ operation: 'connect' });
  }

  _request(message) {
    if (!this.open) throw new Error('Database connection is closed');
    if (this._fatal) throw this._fatal;
    const request = (buffer, command) => {
      const state = new Int32Array(buffer, 0, 4);
      Atomics.store(state, 0, 0);
      this._worker.postMessage({ ...command, shared: buffer });
      if (Atomics.wait(state, 0, 0, this.timeout) === 'timed-out') {
        this._fatal = new Error('PostgreSQL operation timed out; database worker stopped to avoid an uncertain transaction');
        this._fatal.code = 'DATABASE_TIMEOUT';
        this._worker.terminate();
        throw this._fatal;
      }
      return { state, status: Atomics.load(state, 0) };
    };
    let response = request(this._buffer, message);
    if (response.status === 2) {
      const required = Atomics.load(response.state, 1);
      if (required > maxResultSize) {
        request(this._buffer, { operation: 'discard-result' });
        throw new RangeError('PostgreSQL result exceeds 64 MiB response limit');
      }
      this._buffer = new SharedArrayBuffer(required + 16);
      response = request(this._buffer, { operation: 'retrieve-result' });
    }
    const length = Atomics.load(response.state, 1);
    const body = JSON.parse(decoder.decode(new Uint8Array(this._buffer, 16, length)));
    if (response.status === -1) {
      const error = new Error(body.message);
      Object.assign(error, body);
      throw error;
    }
    return body;
  }

  prepare(sql) {
    const database = this;
    const bound = [];
    const statement = {
      source: sql,
      reader: /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql),
      bind(...args) { if (bound.length) throw new Error('Statement already has bound parameters'); bound.push(...args); return statement; },
      get(...args) { return database._query(sql, bound.length ? bound : args, 'get') ?? undefined; },
      all(...args) { return database._query(sql, bound.length ? bound : args, 'all'); },
      run(...args) { return database._query(sql, bound.length ? bound : args, 'run'); },
    };
    return statement;
  }

  _query(sql, args, mode) {
    const query = translateSql(sql, args);
    const result = this._request({ operation: 'query', ...query, mode });
    return mode === 'get' && result === null ? undefined : result;
  }

  exec(sql) {
    this._query(sql, [], 'exec');
    return this;
  }

  pragma(statement, options = {}) {
    if (/^\s*(journal_mode|foreign_keys|busy_timeout)\b/i.test(statement)) return options.simple ? null : [];
    const result = this.prepare(`PRAGMA ${statement}`).all();
    return options.simple ? Object.values(result[0] || {})[0] : result;
  }

  transaction(callback) {
    if (typeof callback !== 'function') throw new TypeError('Transaction requires a function');
    const database = this;
    function transaction(...args) {
      const nested = database._depth > 0;
      const savepoint = `petezah_tx_${database._depth}`;
      database._query(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN', [], 'exec');
      database._depth++;
      database.inTransaction = true;
      try {
        const result = callback.apply(this, args);
        if (result?.then) throw new TypeError('Synchronous database transactions cannot return promises');
        database._query(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT', [], 'exec');
        return result;
      } catch (error) {
        try {
          database._query(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}` : 'ROLLBACK', [], 'exec');
        } catch { /* Preserve the original error when a connection has failed. */ }
        throw error;
      } finally {
        database._depth--;
        database.inTransaction = database._depth > 0;
      }
    }
    transaction.deferred = transaction;
    transaction.immediate = transaction;
    transaction.exclusive = transaction;
    return transaction;
  }

  close() {
    if (this.open) {
      try { this._request({ operation: 'close' }); }
      finally { this.open = false; this._worker.terminate(); }
    }
    return this;
  }
}
