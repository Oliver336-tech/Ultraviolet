import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the live PostgreSQL smoke check');
const { default: db } = await import('../backend/db.js');
const id = `adapter-check-${randomUUID()}`;
const rollback = new Error('Intentional smoke-check rollback');
let checks = 0;
try {
  const columns = db.prepare('PRAGMA table_info(users)').all().map((row) => row.name);
  assert.ok(columns.includes('email_verified'));
  assert.ok(columns.includes('totp_secret'));
  checks++;
  const check = db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO cap_tokens (token_key, expires_at) VALUES (?, ?)').run(id, 1790000000000);
    db.prepare('INSERT OR REPLACE INTO cap_tokens (token_key, expires_at) VALUES (?, ?)').run(id, 1800000000000);
    assert.equal(db.prepare('SELECT expires_at FROM cap_tokens WHERE token_key = ?').get(id).expires_at, 1800000000000);
    checks++;
    const write = db.prepare('INSERT OR REPLACE INTO sessions VALUES (@sid, @sess, @expire)');
    write.run({ sid: id, sess: '{"version":1}', expire: '2030-01-01T00:00:00.000Z' });
    write.run({ sid: id, sess: '{"version":2}', expire: '2030-01-01T00:00:00.000Z' });
    const row = db.prepare("SELECT sess FROM sessions WHERE sid = @sid AND datetime('now') < datetime(expire)").get({ sid: id });
    assert.equal(JSON.parse(row.sess).version, 2);
    checks++;
    const upsert = db.prepare(`INSERT INTO game_plays (game_id, plays, last_played_at) VALUES (?, 1, ?)
      ON CONFLICT(game_id) DO UPDATE SET plays = plays + 1, last_played_at = excluded.last_played_at`);
    upsert.run(id, 1790000000000);
    upsert.run(id, 1800000000000);
    assert.deepEqual(db.prepare('SELECT plays, last_played_at FROM game_plays WHERE game_id = ?').get(id), { plays: 2, last_played_at: 1800000000000 });
    checks++;
    const nested = db.transaction(() => {
      db.prepare('INSERT INTO uploaded_files (id, content_type, content_base64, created_at) VALUES (?, ?, ?, ?)').run(id, 'image/png', 'aGVsbG8=', 1790000000000);
      throw rollback;
    });
    assert.throws(nested, (error) => error.message === rollback.message);
    assert.equal(db.prepare('SELECT id FROM uploaded_files WHERE id = ?').get(id), undefined);
    checks++;
    const alias = db.prepare('SELECT COUNT(*) AS newToday FROM cap_tokens WHERE token_key = ?').get(id);
    assert.equal(alias.newToday, 1);
    checks++;
    throw rollback;
  });
  assert.throws(check, (error) => error.message === rollback.message);
  assert.equal(db.prepare('SELECT token_key FROM cap_tokens WHERE token_key = ?').get(id), undefined);
  assert.equal(db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(id), undefined);
  assert.equal(db.prepare('SELECT game_id FROM game_plays WHERE game_id = ?').get(id), undefined);
  checks++;
  console.log(`PostgreSQL adapter smoke check passed (${checks} checks); temporary data rolled back.`);
} finally {
  db.close();
}
