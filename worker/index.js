/* Baby percentile sync API.
 *
 * End-to-end encrypted: the browser derives every key from a secret that lives only in the share link's
 * #fragment. This Worker stores opaque ciphertext keyed by a derived id, and authorises writes by comparing
 * sha256(write token) to the hash stored at creation. It never sees plaintext, keys, or the read secret.
 *
 * Retention (see cleanup()):
 *   - a profile is deleted after 18 months with no activity (last_seen: set on create/write, and on reads at most
 *     once a day);
 *   - a profile that has never reported any weigh-ins (active = 0) is deleted 1 month after creation.
 */

const MAX_BODY = 70 * 1024;        // request body, bytes
const MAX_BLOB = 64 * 1024;        // ciphertext, chars
const ID_RE = /^[A-Za-z0-9_-]{22}$/;     // 16 random bytes, base64url
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;  // 32 random bytes, base64url
const BLOB_RE = /^[A-Za-z0-9_-]+$/;

const IDLE_MONTHS = 18;
const TOUCH_INTERVAL_MS = 24 * 3600 * 1000;   // reads refresh last_seen at most this often
const EMPTY_GRACE_MONTHS = 1;
const DELETE_BATCH = 500;

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
const err = (status, error) => json({ error }, status);

async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function addMonths(date, n) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

async function readBody(req) {
  const declared = Number(req.headers.get('content-length'));
  if (declared > MAX_BODY) return { status: 413 };
  const text = await req.text();
  if (text.length > MAX_BODY) return { status: 413 };
  try { return { body: JSON.parse(text) }; } catch { return { status: 400 }; }
}

function bearer(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get('authorization') || '');
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
}

async function getProfile(env, id) {
  const row = await env.DB.prepare('SELECT rev, blob, last_seen FROM profiles WHERE id = ?').bind(id).first();
  if (!row) return err(404, 'not_found');
  const now = Date.now();
  if (row.last_seen < now - TOUCH_INTERVAL_MS) {
    await env.DB.prepare('UPDATE profiles SET last_seen = ?1 WHERE id = ?2 AND last_seen < ?3').bind(now, id, now - TOUCH_INTERVAL_MS).run();
  }
  return json({ rev: row.rev, blob: row.blob });
}

async function putProfile(req, env, id) {
  const token = bearer(req);
  if (!token) return err(401, 'unauthorized');
  const parsed = await readBody(req);
  if (parsed.status) return err(parsed.status, parsed.status === 413 ? 'too_large' : 'bad_json');
  const { rev, blob, active } = parsed.body || {};
  if (!Number.isInteger(rev) || rev < 0 || rev > 1e9) return err(400, 'bad_rev');
  if (typeof blob !== 'string' || !blob || blob.length > MAX_BLOB || !BLOB_RE.test(blob)) return err(400, 'bad_blob');
  if (typeof active !== 'boolean') return err(400, 'bad_active');

  const hash = await sha256hex(token);
  const now = Date.now();
  let changed;
  if (rev === 0) {
    // Create. The first writer claims the id; the id is a 128-bit derived value, so squatting isn't feasible.
    const r = await env.DB.prepare(
      'INSERT INTO profiles (id, write_hash, rev, blob, active, created_at, updated_at, last_seen) VALUES (?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING'
    ).bind(id, hash, blob, active ? 1 : 0, now, now, now).run();
    changed = r.meta.changes === 1;
    if (changed) return json({ rev: 1 }, 201);
  } else {
    // Atomic compare-and-set on rev, authorised by the write hash. `active` is sticky.
    const r = await env.DB.prepare(
      'UPDATE profiles SET blob = ?1, rev = rev + 1, active = MAX(active, ?2), updated_at = ?3, last_seen = ?3 WHERE id = ?4 AND rev = ?5 AND write_hash = ?6'
    ).bind(blob, active ? 1 : 0, now, id, rev, hash).run();
    changed = r.meta.changes === 1;
    if (changed) return json({ rev: rev + 1 });
  }

  // Nothing changed: work out why.
  const row = await env.DB.prepare('SELECT rev, blob, write_hash FROM profiles WHERE id = ?').bind(id).first();
  if (!row) return err(404, 'not_found');
  if (!safeEqual(row.write_hash, hash)) return err(401, 'unauthorized');
  return json({ error: 'conflict', rev: row.rev, blob: row.blob }, 409);
}

async function deleteProfile(req, env, id) {
  const token = bearer(req);
  if (!token) return err(401, 'unauthorized');
  const r = await env.DB.prepare('DELETE FROM profiles WHERE id = ? AND write_hash = ?')
    .bind(id, await sha256hex(token)).run();
  return r.meta.changes === 1 ? json({ ok: true }) : err(404, 'not_found');
}

async function limited(req, env) {
  if (!env.LIMITER) return false;
  const key = req.headers.get('cf-connecting-ip') || 'anon';
  const { success } = await env.LIMITER.limit({ key });
  return !success;
}

export async function cleanup(env, now = new Date()) {
  const idleCutoff = addMonths(now, -IDLE_MONTHS).getTime();
  const emptyCutoff = addMonths(now, -EMPTY_GRACE_MONTHS).getTime();
  let total = 0;
  for (;;) {
    const r = await env.DB.prepare(
      'DELETE FROM profiles WHERE id IN (SELECT id FROM profiles WHERE last_seen < ?1 OR (active = 0 AND created_at < ?2) LIMIT ?3)'
    ).bind(idleCutoff, emptyCutoff, DELETE_BATCH).run();
    total += r.meta.changes;
    if (r.meta.changes < DELETE_BATCH) break;
  }
  console.log(`cleanup: deleted ${total} profile(s)`); // counts only, never ids
  return total;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = /^\/api\/p\/([^/]+)$/.exec(url.pathname);
    if (!m) return url.pathname.startsWith('/api/') ? err(404, 'not_found') : env.ASSETS.fetch(req);
    const id = m[1];
    if (!ID_RE.test(id)) return err(400, 'bad_id');
    if (await limited(req, env)) return err(429, 'rate_limited');
    switch (req.method) {
      case 'GET': return getProfile(env, id);
      case 'PUT': return putProfile(req, env, id);
      case 'DELETE': return deleteProfile(req, env, id);
      default: return err(405, 'method_not_allowed');
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
};
