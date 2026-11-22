// Runs against a local `wrangler dev --test-scheduled` (default http://localhost:8799).
//   npm run dev   # in one terminal (after npm run migrate:local)
//   npm test      # in another
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:8799';
const b64u = n => randomBytes(n).toString('base64url');
const newId = () => b64u(16);
const newToken = () => b64u(32);
const blob = () => b64u(48);

const req = (method, id, { token, body } = {}) =>
  fetch(`${BASE}/api/p/${id}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

const sql = cmd => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', cmd], { stdio: 'pipe' });

test('create, read, update, conflict', async () => {
  const id = newId(), token = newToken(), b1 = blob(), b2 = blob();
  assert.equal((await req('GET', id)).status, 404);

  let r = await req('PUT', id, { token, body: { rev: 0, blob: b1, active: true } });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { rev: 1 });

  r = await req('GET', id);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { rev: 1, blob: b1 });
  assert.equal(r.headers.get('cache-control'), 'no-store');

  r = await req('PUT', id, { token, body: { rev: 1, blob: b2, active: true } });
  assert.deepEqual(await r.json(), { rev: 2 });

  // stale rev -> 409 with the current copy
  r = await req('PUT', id, { token, body: { rev: 1, blob: blob(), active: true } });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'conflict', rev: 2, blob: b2 });

  // creating again with the same owner is a conflict, not an overwrite
  r = await req('PUT', id, { token, body: { rev: 0, blob: blob(), active: true } });
  assert.equal(r.status, 409);
});

test('wrong or missing write token cannot write or delete', async () => {
  const id = newId(), token = newToken(), b1 = blob();
  await req('PUT', id, { token, body: { rev: 0, blob: b1, active: false } });

  assert.equal((await req('PUT', id, { body: { rev: 1, blob: blob(), active: false } })).status, 401);
  assert.equal((await req('PUT', id, { token: newToken(), body: { rev: 1, blob: blob(), active: false } })).status, 401);
  assert.equal((await req('PUT', id, { token: newToken(), body: { rev: 0, blob: blob(), active: false } })).status, 401);
  assert.equal((await req('DELETE', id, { token: newToken() })).status, 404);
  assert.deepEqual(await (await req('GET', id)).json(), { rev: 1, blob: b1 });

  assert.equal((await req('DELETE', id, { token })).status, 200);
  assert.equal((await req('GET', id)).status, 404);
});

test('input validation', async () => {
  const token = newToken();
  assert.equal((await req('GET', 'short')).status, 400);
  assert.equal((await req('PUT', newId(), { token, body: 'not json' })).status, 400);
  assert.equal((await req('PUT', newId(), { token, body: { rev: 0, blob: 'has spaces!', active: true } })).status, 400);
  assert.equal((await req('PUT', newId(), { token, body: { rev: 0, blob: blob() } })).status, 400);
  assert.equal((await req('PUT', newId(), { token, body: { rev: -1, blob: blob(), active: true } })).status, 400);
  assert.equal((await req('PUT', newId(), { token, body: { rev: 0, blob: 'A'.repeat(64 * 1024 + 1), active: true } })).status, 400);
  assert.equal((await req('PUT', newId(), { token, body: { rev: 0, blob: 'A'.repeat(80 * 1024), active: true } })).status, 413);
  assert.equal((await req('POST', newId())).status, 405);
});

const MONTH = 31 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;
const query = cmd => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', cmd], { stdio: 'pipe' }).toString())[0].results;
const runCleanup = async () => { assert.equal((await fetch(`${BASE}/cdn-cgi/handler/scheduled`)).status, 200); await new Promise(res => setTimeout(res, 500)); };

test('retention: 18 months idle, or 1 month if never active', async () => {
  const now = Date.now();
  const h = 'a'.repeat(64);
  // age = months since creation, idle = months since last activity
  const mk = (id, active, ageMonths, idleMonths) =>
    `INSERT INTO profiles (id, write_hash, rev, blob, active, created_at, updated_at, last_seen) VALUES ('${id}', '${h}', 1, 'AAAA', ${active}, ${now - ageMonths * MONTH}, ${now - idleMonths * MONTH}, ${now - idleMonths * MONTH});`;
  const ids = { fresh: newId(), emptyYoung: newId(), emptyOld: newId(), idle17: newId(), idle19: newId(), oldButUsed: newId() };
  sql([
    mk(ids.fresh, 1, 0.1, 0.1),        // keep
    mk(ids.emptyYoung, 0, 0.5, 0.5),   // keep: never active but within the 1-month grace
    mk(ids.emptyOld, 0, 1.5, 0.1),     // delete: never active, older than 1 month (even if touched recently)
    mk(ids.idle17, 1, 30, 17),         // keep: idle under 18 months
    mk(ids.idle19, 1, 30, 19),         // delete: idle over 18 months
    mk(ids.oldButUsed, 1, 60, 1),      // keep: no age cap while it's in use
  ].join(' '));
  await runCleanup();

  const status = async id => (await req('GET', id)).status;
  assert.equal(await status(ids.fresh), 200);
  assert.equal(await status(ids.emptyYoung), 200);
  assert.equal(await status(ids.emptyOld), 404);
  assert.equal(await status(ids.idle17), 200);
  assert.equal(await status(ids.idle19), 404);
  assert.equal(await status(ids.oldButUsed), 200);
});

test('a read keeps an idle profile alive (refreshing last_seen at most daily)', async () => {
  const id = newId(), token = newToken(), now = Date.now();
  await req('PUT', id, { token, body: { rev: 0, blob: blob(), active: true } });
  const lastSeen = () => query(`SELECT last_seen FROM profiles WHERE id = '${id}'`)[0].last_seen;

  // 17.5 months idle -> a read refreshes it, so it survives a later sweep that would otherwise have deleted it
  sql(`UPDATE profiles SET last_seen = ${now - 17.5 * MONTH} WHERE id = '${id}';`);
  assert.equal((await req('GET', id)).status, 200);
  assert.ok(lastSeen() > now - DAY, 'read should refresh last_seen');

  // a second read within a day must not write again
  const t = now - 3600 * 1000;
  sql(`UPDATE profiles SET last_seen = ${t} WHERE id = '${id}';`);
  await req('GET', id);
  assert.equal(lastSeen(), t);

  // a write also refreshes it
  sql(`UPDATE profiles SET last_seen = ${now - 17.5 * MONTH} WHERE id = '${id}';`);
  await req('PUT', id, { token, body: { rev: 1, blob: blob(), active: true } });
  assert.ok(lastSeen() > now - DAY, 'write should refresh last_seen');
});

test('active flag is sticky', async () => {
  const id = newId(), token = newToken();
  await req('PUT', id, { token, body: { rev: 0, blob: blob(), active: true } });
  await req('PUT', id, { token, body: { rev: 1, blob: blob(), active: false } }); // client later reports empty
  sql(`UPDATE profiles SET created_at = ${Date.now() - 2 * MONTH} WHERE id = '${id}';`);
  await fetch(`${BASE}/cdn-cgi/handler/scheduled`);
  await new Promise(res => setTimeout(res, 500));
  assert.equal((await req('GET', id)).status, 200); // still there: it was active once
});
