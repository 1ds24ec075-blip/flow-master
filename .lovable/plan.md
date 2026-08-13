# Backend Migration: Lowest-Risk, Lowest-Effort Path

Goal: move the backend (database, auth users, storage, edge functions) to your own Supabase project with nothing breaking, and with the least manual work.

Key decision: **do a full physical database copy (dump/restore), not a replay of the 67 migration files.**
A dump/restore carries schema + data + RLS policies + triggers + functions + `auth.users` (including password hashes and identities) in one shot. Replaying migrations means re-running 67 files, then hand-moving data in dependency order, then re-creating every user — many more steps and many more ways to break.

## What exists today (verified)

- 67 migration files, 34 edge functions (plus `_shared`)
- Two storage buckets: `bills`, `po-documents` (private, signed URLs)
- Frontend reads backend config from `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`) — only one hardcoded project reference remains, in `src/lib/mcp/index.ts` (OAuth issuer URL)
- Functions depend on secrets: Google/Microsoft OAuth, Gmail SMTP, `OPENAI_API_KEY`, `OAUTH_STATE_SECRET`, and `LOVABLE_API_KEY` (used by 8 AI functions)
- A desktop Tally agent polls the backend with its own API key

## Step 0 — Fix the four build errors first

Inserts missing the required `company_id` in `Clients.tsx`, `Quotations.tsx`, `RawMaterialInvoices.tsx`, `SupplierDashboard.tsx`. Fix before migrating so the new backend is validated against a clean build.

## Step 1 — Create the target project

New Supabase project in the region closest to your users, on a paid tier (needed for the scale you described and for reliable restores). Keep the DB password safe; the CLI needs it.

## Step 2 — Copy the database (one command set)

From your machine with the Supabase CLI:

```bash
supabase db dump --db-url "<SOURCE_DB_URL>" -f roles.sql --role-only
supabase db dump --db-url "<SOURCE_DB_URL>" -f schema.sql
supabase db dump --db-url "<SOURCE_DB_URL>" -f data.sql --use-copy --data-only
psql "<TARGET_DB_URL>" -f schema.sql
psql "<TARGET_DB_URL>" -f data.sql
```

Then a separate dump/restore of `auth.users`, `auth.identities`, `storage.objects` metadata so logins and file links keep working (passwords survive because hashes come along; Google-login users keep working once the provider is configured with the new callback URL).

Verification: row counts per table compared source vs target, plus a spot check that RLS policies and triggers came across.

## Step 3 — Copy storage objects

Script that lists every object in `bills` and `po-documents` on the old project and re-uploads to the new one at the identical path, so all stored `image_url` / `file_path` values stay valid. Buckets recreated as private, same names.

## Step 4 — Deploy the 34 edge functions

`supabase functions deploy --project-ref <NEW_REF>` for all of them, then set secrets. Two things must change:

- `LOVABLE_API_KEY` is Lovable-only. The 8 AI functions get switched to a direct Gemini (or OpenAI) key read from a new secret, with the same model behaviour.
- OAuth callback URLs (Gmail, Microsoft/Excel) must be re-registered in Google Cloud and Azure to point at the new project's function URLs, otherwise connect flows fail.

## Step 5 — Point the frontend at the new backend

Swap the three `VITE_SUPABASE_*` values and update the MCP issuer in `src/lib/mcp/index.ts` to read the project ref from env instead of a hardcoded string. Then hosting: GitHub repo → Vercel/Netlify with those env vars.

## Step 6 — Cutover with a rollback door

1. Do steps 2-4 as a **rehearsal** while the old backend stays live; test sign-in, a bill extraction, a Tally enqueue against the new project.
2. Freeze writes briefly (announce a short window), re-run a delta data dump so nothing written during rehearsal is lost.
3. Flip the frontend env vars and re-point the Tally agent's `.env` to the new URL + a newly issued bridge key.
4. Keep the old backend untouched for a week. Rollback = flip the env vars back.

## Effort estimate

Steps 2, 3, 5 are scripted and fast. The real work is Step 4's OAuth re-registration and the AI-key swap, plus the rehearsal. Expect one focused session for rehearsal and a short freeze window for the real cutover.

## What I need from you before building

- Whether you want me to (a) prepare all the scripts, code changes and a copy-paste runbook you run against your own project, or (b) also drive the parts I can reach from here.
- The AI provider for the 8 functions after the switch: direct Gemini key, or OpenAI (key already present).
