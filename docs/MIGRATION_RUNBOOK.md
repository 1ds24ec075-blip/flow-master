# Manual Migration Runbook — Lovable Cloud → Your Own Supabase

**Context:** Lovable credits are exhausted, so there is **no Lovable GUI, no Lovable
hosting, and no Lovable-hosted services**. Everything below is done from your
laptop against your own Supabase project + a host you control. The original
"connect your Supabase in Lovable" path (old Step 4) is **not available** — this
runbook replaces it end to end.

> **Reality check on rollback:** The old plan treated Lovable Cloud as a rollback
> door. With credits gone, Lovable may de-provision the old backend at any time —
> **assume the old backend is already gone or will be soon.** Your real rollback
> artifact is now the `.backup` dump file. Guard it: keep at least two copies
> (laptop + password manager / encrypted drive). Do not delete it until the new
> stack has run cleanly for a week.

---

## 0. What actually dies with Lovable (the dependency map)

Found by scanning the repo. These are the things that stop working the moment
Lovable is gone, and how each is handled:

| Lovable dependency | Where | Fix |
|---|---|---|
| `ai.gateway.lovable.dev` (AI for 7–8 functions) | edge functions | **Swap to OpenAI** (Section 4a) — required |
| `connector-gateway.lovable.dev` (Gmail proxy) | `gmail-connector-sync` | **Dead.** Use the direct Gmail OAuth path (`gmail-auth-*` + `gmail-sync`) instead. `gmail-connector-sync` can't work without Lovable. |
| Frontend hosting | (Lovable hosted the app) | **Self-host** on Vercel / Netlify / Cloudflare Pages (Section 6) |
| `VITE_SUPABASE_*` hardcoded to old project | `vite.config.ts` | **Fixed in code** — now reads from env (see Section 4, already done) |
| Old project ref | `supabase/config.toml`, `excel-auth-callback` | Re-point during deploy (Section 5) |
| MCP OAuth issuer ref | generated at build from `VITE_SUPABASE_PROJECT_ID` | Handled automatically **if you build with the new env before deploying** (Section 5) |

---

## 1. Prerequisites (on your laptop)

- [ ] **PostgreSQL 17 client tools** (`pg_restore`, `psql`). You already have these —
      the dump was made with them. Verify: `pg_restore --version` → 17.x.
- [ ] **Supabase CLI**: `npm i -g supabase` (or `brew install supabase/tap/supabase`).
      Verify: `supabase --version`.
- [ ] **Node 18+** and this repo cloned locally on the branch
      `claude/lovable-supabase-migration-5e2wk7`.
- [ ] **The dump file**: `1a047f45-bizcraftstream_260817.backup` (~836 KB).
- [ ] **Your new Supabase project** created (you have this) — have its **DB password**
      and **connection string** ready.
- [ ] Accounts you'll still need: **Google Cloud Console** (for Gmail integration),
      an **OpenAI** account with a valid `OPENAI_API_KEY` + quota, your **Gmail SMTP**
      app password. (Microsoft/Azure is **not needed** — Excel integration is disabled.)

---

## 2. Restore the database

The `.backup` is a full `pg_dump` (custom format) of the old Supabase DB —
`public` (your app), plus the managed `auth`, `storage`, `realtime`, etc. You
restore only the safe parts; the managed schemas already exist on a fresh project.

**2.1 — Get the connection string** (Supabase Dashboard → Project Settings →
Database → Connection string):

- Use the **Direct connection**, port **5432**.
- If your laptop is IPv4-only and the direct host won't resolve, use the
  **Session pooler** (port **5432**, host `aws-0-<region>.pooler.supabase.com`).
  **Do not** use the transaction pooler (6543) — `pg_restore` needs a session.

```bash
DEST="postgresql://postgres:[DB-PASSWORD]@db.[NEW-PROJECT-REF].supabase.co:5432/postgres"
F=1a047f45-bizcraftstream_260817.backup
```

**2.2 — Restore in this order** (users first, because `public` tables have foreign
keys into `auth.users`):

```bash
# 1) auth users (carries password hashes + FK targets)
pg_restore --no-owner --no-privileges --data-only --disable-triggers \
  --schema=auth -d "$DEST" "$F"

# 2) your app data, triggers, indexes
pg_restore --no-owner --no-privileges --no-acl --clean --if-exists \
  --schema=public -d "$DEST" "$F"

# 3) storage bucket / object metadata (NOT the files themselves)
pg_restore --no-owner --no-privileges --data-only --disable-triggers \
  --schema=storage -d "$DEST" "$F"
```

**2.3 — Errors you can ignore vs. must read:**
- Ignore: `role ... already exists`, `extension ... already exists`,
  `schema ... already exists`, duplicate-object notices on `auth`/`storage`.
- Must read: any error on a `public.*` table/constraint.

**2.4 — Verify (do not skip):**
- [ ] Row counts match old vs new on `bills`, `companies`, `purchase_orders`,
      `client_invoices`, `tally_sync_queue`.
- [ ] **Log in as an existing user** on the new project → proves password hashes
      landed.
- [ ] A trigger fires — e.g. insert a duplicate PO number and confirm
      `check_duplicate_po_number` blocks it.
- [ ] Buckets `bills` and `po-documents` exist and are **private**.

---

## 3. Copy the storage FILES (urgent if the old project is still reachable)

The dump has only storage **metadata rows**, not the actual PDFs/images. Your DB
will reference `file_path` / `image_url` values that won't resolve until the files
are copied. **If Lovable's old Supabase is still up, pull these NOW before it's
de-provisioned — otherwise they're lost.**

You need the **old** project's URL + **service_role** key, and the **new** ones.
Then copy each bucket (`bills`, `po-documents`). Minimal Node script:

```js
// copy-storage.js  —  run: node copy-storage.js
import { createClient } from '@supabase/supabase-js';
const OLD = createClient(process.env.OLD_URL, process.env.OLD_SERVICE_KEY);
const NEW = createClient(process.env.NEW_URL, process.env.NEW_SERVICE_KEY);
for (const bucket of ['bills', 'po-documents']) {
  const { data: files, error } = await OLD.storage.from(bucket).list('', { limit: 10000 });
  if (error) { console.error(bucket, error); continue; }
  for (const f of files) {
    const { data: blob, error: dErr } = await OLD.storage.from(bucket).download(f.name);
    if (dErr) { console.error('download', f.name, dErr); continue; }
    const { error: uErr } = await NEW.storage.from(bucket).upload(f.name, blob, { upsert: true });
    console.log(bucket, f.name, uErr ? 'FAIL '+uErr.message : 'ok');
  }
}
```
> This handles a flat listing. If your buckets use nested folders, recurse into
> subfolders (list returns folders with `id === null`). Ask and I'll extend it.

- [ ] Files copied; spot-check that a bill's `image_url` opens via a signed URL on
      the new project.

---

## 4. Code changes

### Already done in the repo (branch `claude/lovable-supabase-migration-5e2wk7`)
- ✅ `vite.config.ts` now reads `VITE_SUPABASE_*` from the environment instead of
  hardcoding the old project. **This is why setting env vars now actually works.**
- ✅ `.env.example` added — copy to `.env` and fill in your new project's values.
- ✅ Google **sign-in button** and **Excel/Microsoft integration** hidden (earlier commit).
- ✅ Build fixes (`company_id`) — from earlier.

### 4a. Swap AI from Lovable gateway → OpenAI  (REQUIRED — not yet applied)
The AI functions call `https://ai.gateway.lovable.dev/v1/chat/completions` with
models `google/gemini-2.5-flash` / `google/gemini-2.5-pro`, authed by
`LOVABLE_API_KEY`. That gateway is gone. In each affected function change:

| From | To |
|---|---|
| `https://ai.gateway.lovable.dev/v1/chat/completions` | `https://api.openai.com/v1/chat/completions` |
| `Deno.env.get('LOVABLE_API_KEY')` | `Deno.env.get('OPENAI_API_KEY')` |
| `"google/gemini-2.5-flash"` | `"gpt-4o-mini"` (or your choice) |
| `"google/gemini-2.5-pro"` | `"gpt-4o"` (vision-capable, for bill extraction) |

The gateway was OpenAI-compatible, so request/response shapes mostly carry over.
**Test `bill-extract` end-to-end** after — that path uses image input, so confirm
the model you pick is vision-capable and the JSON output format didn't drift.
Affected functions: `bill-extract`, `generate-insights`, `cash-crisis-predictor`,
`morning-brief`, `process-po`, `smart-segregation`, `tally-ai-chat`
(+ `gmail-connector-sync` is dead — leave it).

> This is the one change with real behavior risk. Have me apply it so it's
> consistent across all functions, then you test one extraction.

### 4b. `gmail-connector-sync` is dead
It proxies Gmail through `connector-gateway.lovable.dev`. Don't deploy/rely on it.
The direct path (`gmail-auth-start` → `gmail-auth-callback` → `gmail-sync`) talks
to Google directly and is what you keep.

---

## 5. Deploy edge functions to the new project

```bash
# link the CLI to your NEW project (updates supabase/config.toml project_id)
supabase link --project-ref [NEW-PROJECT-REF]

# IMPORTANT: build the frontend FIRST with the new env set, so the generated
# supabase/functions/mcp/index.ts gets the NEW project ref baked into its OAuth
# issuer (it's inlined from VITE_SUPABASE_PROJECT_ID at build time).
cp .env.example .env   # then edit .env with your real new-project values
npm run build

# deploy all functions
supabase functions deploy
```

**5.1 — Set secrets on the new project** (`supabase secrets set KEY=value`, or the
Dashboard → Edge Functions → Secrets):

- `OPENAI_API_KEY`  ← the AI key (replaces `LOVABLE_API_KEY`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  (Gmail)
- `OAUTH_STATE_SECRET`
- `GMAIL_SMTP_USER`, `GMAIL_SMTP_PASSWORD`
- `GOOGLE_VISION_API_KEY` (if you use Vision OCR in bill-extract)
- `FRONTEND_URL` = your new hosted frontend URL (used by auth callbacks)
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform — don't set manually.
- **Skip** all `MICROSOFT_*` (Excel disabled) and `LOVABLE_API_KEY`.

- [ ] `verify_jwt = false` functions in `config.toml` deployed as public (po-upload, etc.) — confirm they came across.

---

## 6. Host the frontend yourself

Lovable no longer serves the app. Pick one (Vercel / Netlify / Cloudflare Pages).
All work the same way for a Vite SPA:

- **Build command:** `npm run build`  **Output dir:** `dist`
- **Env vars** (set in the host dashboard, build-time):
  - `VITE_SUPABASE_URL` = `https://[NEW-REF].supabase.co`
  - `VITE_SUPABASE_PROJECT_ID` = `[NEW-REF]`
  - `VITE_SUPABASE_ANON_KEY` = new project's anon/public key
- **SPA rewrite** (so deep links work): route all paths to `/index.html`.
  - Vercel: add `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }` in `vercel.json`.
  - Netlify: `/* /index.html 200` in a `_redirects` file (or `netlify.toml`).
- [ ] After first deploy, open the site → confirm it loads and talks to the **new**
      backend (network tab shows `[NEW-REF].supabase.co`, not the old ref).

> Want me to add the `vercel.json` / `netlify.toml` to the repo? Say which host.

---

## 7. Re-register OAuth callbacks (Google only)

Microsoft/Azure is **skipped** (Excel disabled). Google **sign-in** is also
disabled, but the **Gmail integration** still uses Google OAuth, so:

- **Google Cloud Console** → your OAuth client → **Authorized redirect URIs** → add:
  `https://[NEW-REF].supabase.co/functions/v1/gmail-auth-callback`
- [ ] Connect a Gmail account on the new stack and confirm the round-trip completes
      and a real email syncs end-to-end.

---

## 8. Re-point the Tally agent

- [ ] Edit the Tally agent's `config.json`: new **Supabase URL** + a **newly issued
      bridge/agent key** from the new project.
- [ ] **Active check** (this fails silently if wrong): enqueue one test bill, then
      confirm a row lands in `tally_sync_queue` on the new project within a few
      minutes. Don't wait 24h to discover a typo.

---

## 9. Smoke test (production)

- [ ] Sign in (email/password).
- [ ] Upload a bill → extract (OpenAI path) → correct fields.
- [ ] Send to Tally → lands correctly.
- [ ] Gmail sync pulls a real email.
- [ ] Watch the agent 24–48h — confirm it's polling the new backend.

---

## 10. Multi-tenancy isolation test (before any pilot customer)

- [ ] Second dummy company + user; User A sees **zero** rows from Company B across
      all scoped tables (`bills`, `suppliers`, `transactions`, `tally_sync_queue`,
      `po_orders`, `client_invoices`, …).
- [ ] User A cannot fetch Company B's files via signed URL.
- [ ] Edge functions using `SECURITY DEFINER` / service-role actually filter by
      `company_id` (RLS alone doesn't cover service-role calls).
- [ ] `tally_agents` has an owner/company column; a user can't mint/revoke another
      company's agent token.

---

## Order of operations (short version)

1. Restore DB (§2) → verify.
2. Copy storage files (§3) — **urgent while old project lives**.
3. Apply AI swap (§4a) — have me do it.
4. `.env` + `npm run build` + `supabase link` + set secrets + `functions deploy` (§5).
5. Host frontend with env vars (§6).
6. Google callback (§7).
7. Tally re-point (§8).
8. Smoke test (§9) → isolation test (§10).
9. Keep the `.backup` for a week (rollback artifact).
