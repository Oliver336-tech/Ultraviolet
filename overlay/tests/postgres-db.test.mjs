import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSql } from '../backend/utils/postgres-sql.js';
import PostgresDatabase from '../backend/utils/postgres-db.js';
import { postgresConnectionOptions } from '../backend/utils/postgres-tls.js';

const compact = (text) => text.replace(/\s+/g, ' ').trim();

test('only real bindings are replaced; literal, comment, dollar quote, and casts survive', () => {
  const query = translateSql(`SELECT '?' AS literal, $$@ignored?$$ AS dollar, ?::bigint AS answer
    -- @ignored ?
    WHERE email = @email OR username = @email`, [{ email: 'name@example.org' }, 42]);
  assert.equal(query.values.length, 2);
  assert.deepEqual(query.values, [42, 'name@example.org']);
  assert.match(query.text, /\$1::bigint/);
  assert.match(query.text, /email = \$2 OR username = \$2/);
  assert.match(query.text, /'\?' AS literal/);
  assert.match(query.text, /\$\$@ignored\?\$\$/);
  assert.match(query.text, /-- @ignored \?/);
});

test('DDL preserves millisecond timestamps, auto IDs, and string session payloads', () => {
  const query = translateSql(`CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,
    sess JSON NOT NULL, created_at INTEGER, description TEXT DEFAULT 'INTEGER JSON');`);
  assert.match(query.text, /id BIGSERIAL PRIMARY KEY/);
  assert.match(query.text, /sess TEXT NOT NULL/);
  assert.match(query.text, /created_at BIGINT/);
  assert.match(query.text, /'INTEGER JSON'/);
  assert.doesNotMatch(query.text, /AUTOINCREMENT/);
});

test('session writes overwrite the same key and expiry comparison uses timestamps', () => {
  const write = translateSql(`INSERT OR REPLACE INTO sessions VALUES (@sid, @sess, @expire)`,
    [{ sid: 'session', sess: '{"user":"one"}', expire: '2026-09-30T12:00:00Z' }]);
  assert.equal(compact(write.text), 'INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3) ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire');
  assert.deepEqual(write.values, ['session', '{"user":"one"}', '2026-09-30T12:00:00Z']);
  const read = translateSql(`SELECT sess FROM sessions WHERE sid = @sid AND datetime('now') < datetime(expire)`, [{ sid: 'session' }]);
  assert.match(read.text, /CURRENT_TIMESTAMP < \(expire\)::timestamptz/);
  assert.deepEqual(read.values, ['session']);
});

test('upsert arithmetic refers to the target without touching excluded values', () => {
  const query = translateSql(`INSERT INTO usage_daily (day, metric, count) VALUES (?, ?, ?)
    ON CONFLICT(day, metric) DO UPDATE SET count = count + excluded.count`, ['2026-09-30', 'games', 7]);
  assert.match(query.text, /count = usage_daily.count \+ excluded.count/);
  assert.deepEqual(query.values, ['2026-09-30', 'games', 7]);
  const plays = translateSql(`INSERT INTO user_stats (user_id, games_played, unique_games) VALUES (?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET games_played = games_played + 1, unique_games = unique_games + ?`, ['one', 1, 1]);
  assert.match(plays.text, /games_played = user_stats.games_played \+ 1/);
  assert.match(plays.text, /unique_games = user_stats.unique_games \+ \$3/);
});

test('conflict ignoring, named columns, aliases, and schema inspection are portable', () => {
  assert.match(translateSql('INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?);', ['u', 'a']).text, /ON CONFLICT DO NOTHING$/);
  assert.match(translateSql('INSERT OR REPLACE INTO cap_tokens (token_key, expires_at) VALUES (?, ?)', ['t', 1790000000000]).text, /ON CONFLICT \(token_key\) DO UPDATE SET expires_at = EXCLUDED.expires_at/);
  assert.match(translateSql('SELECT COUNT(*) AS newToday FROM users').text, /AS "newToday"/);
  const info = translateSql('PRAGMA table_info(users)');
  assert.match(info.text, /information_schema.columns/);
  assert.deepEqual(info.values, ['users']);
  assert.throws(() => translateSql('SELECT ?', []), /Too few/);
  assert.throws(() => translateSql('SELECT 1', [2]), /Too many/);
  assert.throws(() => translateSql('SELECT @missing', [{}]), /Missing/);
});

function transactionHarness() {
  const database = Object.create(PostgresDatabase.prototype);
  database._depth = 0;
  database.inTransaction = false;
  const calls = [];
  database._query = (sql) => { calls.push(sql); return {}; };
  return { database, calls };
}

test('transaction callbacks are bracketed by commit and nested savepoints', () => {
  const { database, calls } = transactionHarness();
  const nested = database.transaction((value) => { assert.equal(database.inTransaction, true); return value * 2; });
  const outer = database.transaction((value) => nested(value) + 1);
  assert.equal(outer(3), 7);
  assert.deepEqual(calls, ['BEGIN', 'SAVEPOINT petezah_tx_1', 'RELEASE SAVEPOINT petezah_tx_1', 'COMMIT']);
  assert.equal(database.inTransaction, false);
  assert.equal(database._depth, 0);
});

test('throwing callbacks roll back; outer transactions can recover from a nested error', () => {
  const { database, calls } = transactionHarness();
  const error = new Error('Abort change');
  const nested = database.transaction(() => { throw error; });
  const outer = database.transaction(() => { assert.throws(nested, (thrown) => thrown === error); return 'safe'; });
  assert.equal(outer(), 'safe');
  assert.deepEqual(calls, ['BEGIN', 'SAVEPOINT petezah_tx_1', 'ROLLBACK TO SAVEPOINT petezah_tx_1; RELEASE SAVEPOINT petezah_tx_1', 'COMMIT']);
  const fail = database.transaction(() => { throw error; });
  assert.throws(fail, (thrown) => thrown === error);
  assert.deepEqual(calls.slice(-2), ['BEGIN', 'ROLLBACK']);
  assert.equal(database._depth, 0);
});

test('async callbacks cannot commit a transaction early', () => {
  const { database, calls } = transactionHarness();
  assert.throws(database.transaction(() => Promise.resolve('later')), /cannot return promises/);
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK']);
});

test('verified TLS cannot be weakened or lose its CA through connection URL parameters', () => {
  const ca = '-----BEGIN CERTIFICATE-----\nverified test CA\n-----END CERTIFICATE-----';
  const options = postgresConnectionOptions('postgresql://user:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true', true, ca);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, ca);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
  assert.equal(new URL(options.connectionString).searchParams.has('uselibpqcompat'), false);
  assert.equal(options.ssl.checkServerIdentity, undefined);
  const ordinary = postgresConnectionOptions('postgresql://user:password@localhost:5432/postgres');
  assert.deepEqual(ordinary.ssl, { rejectUnauthorized: true });
});
