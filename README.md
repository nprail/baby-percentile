# Baby weight percentile calculator

Compares a baby's weights to the CDC weight-for-age chart, birth to 36 months. A Vite + React app (Tailwind, Recharts, self-hosted fonts; nothing loads from a CDN) plus a tiny Cloudflare
Worker that provides optional, account-free, end-to-end encrypted sync and sharing.

- `src/main.jsx`: the whole app. `src/growthData.js` is the CDC data embedded as a module.
- `wtageinf.csv`: the CDC source data (kg).
- `worker/index.js`: the sync API (`GET/PUT/DELETE /api/p/:id`) and the daily cleanup cron.
- `migrations/`: the D1 schema.
- `public/_headers`: security headers. The CSP is strict (`script-src 'self'`, no third-party origins), which is
  what makes the end-to-end encryption claim meaningful: only this app's own code can touch the keys.

Without sync, entries live in the browser's localStorage (`bpc-v1`).

## How sync works

"Sync & share" creates a random 256-bit secret that exists only in the link's `#fragment`, which browsers never
send to a server. All keys are derived from it in the browser with HKDF:

```
edit secret M ─► read secret R  ─► id (lookup key)  and  AES-GCM key K
              └► write token W
edit link = #/e/M   (can read and write)      view link = #/v/R   (can read, cannot derive W)
```

The Worker stores ciphertext under `id` and authorises writes by comparing `sha256(W)` to the hash stored at
creation. It never sees M, R, K or any data. Writes use an atomic `rev` compare-and-set; on a conflict the client
merges entries by id (with tombstones for removals) and retries. Each ciphertext is bound to its id and revision
through the AES-GCM associated data.

**Retention:** a profile is deleted after 18 months with no activity (`last_seen`, set on create and on every write,
and refreshed by reads at most once a day), or 1 month after creation if no weigh-ins were ever reported (a sticky
`active` flag, the only thing about the contents the server learns). A daily cron enforces it.

There are no accounts, so a lost link can't be recovered.

## Develop

```bash
npm install
npm run migrate:local
npm run dev:api    # Worker + local D1 on :8787
npm run dev        # Vite on :5173 with hot reload; proxies /api to :8787
```

Tests run against a local Worker on port 8799 and cover create/update/conflict, auth, validation and both
retention rules:

```bash
npm run build && npx wrangler dev --test-scheduled --port 8799   # terminal 1
npm test                                                           # terminal 2
```

## Deploy

```bash
npx wrangler login
npm run deploy             # builds, then deploys; provisions the D1 database on first deploy
npm run migrate:remote
```

Then attach a custom domain to the Worker (Workers & Pages → baby-percentile → Settings → Domains, or a `routes`
entry with `"custom_domain": true` in `wrangler.jsonc`).
