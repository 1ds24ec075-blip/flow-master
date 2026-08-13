# Move Talligence onto your own Supabase project

Goal: run the whole backend (database, auth, storage, edge functions) on a Supabase project you own and control, with all current data carried across, and the frontend hosted by you.

## What exists today (verified)

- ~60 SQL migration files already in `supabase/migrations/` — the full schema history is in the repo.
- 34 edge functions in `supabase/functions/`, plus shared code in `_shared/` (tally serializer, matching, auth helpers).
- 60+ tables, 5 enum types, 17 database functions, ~45 triggers, RLS on all business tables via `user_company_ids()` / `is_company_admin()`.
- 2 storage buckets, both private: `bills`, `po-documents`.
- 18 backend secrets (Google OAuth, Microsoft/Excel, SMTP, OpenAI, `LOVABLE_API_KEY`, OAuth state secret).
- A desktop Tally agent (`agent/`) that authenticates with its own token and talks to edge functions.
- An MCP server whose OAuth issuer is derived from `VITE_SUPABASE_PROJECT_ID`.
- `vite.config.ts` currently hardcodes the current project URL/keys in `define` — this must become real env vars.

## Migration phases

### 1. Create and prepare the new project
You create a Supabase project (region close to your users, e.g. Mumbai), on a paid tier if you need larger compute/connections. Capture: project ref, URL, publishable/anon key, service role key, database password.

### 2. Schema
Push the existing migration history to the new database with the Supabase CLI (`supabase link` + `supabase db push`). This recreates tables, enums, functions, triggers, RLS policies and grants exactly as they evolved here — no hand-rewriting.
Then verify: table count, enum types, RLS enabled everywhere, `has_role`/`user_company_ids` present, GRANTs on every public table.

### 3. Data
Order matters because of foreign keys: `companies` → masters (`clients`, `suppliers`, `customer_master`, `product_master`, `expense_categories`, `ledger_master`, `inventory_items`) → documents (`bills`, `po_orders`, `purchase_orders`, invoices, quotations) → children (line items, audit events, queue rows, ledger entries, bank data).
Two options for the actual copy, decided by whether you can obtain a direct DB connection string for the current project:
- Preferred: `pg_dump --data-only` from the current database into `psql` on the new one.
- Fallback (always available): export each table to CSV/JSON through the SQL editor here, then load into the new project in the dependency order above with triggers temporarily disabled so `fill_company_id` and ledger triggers don't duplicate rows.
After load: re-enable triggers, reset sequences, and run row-count comparisons per table.

### 4. Auth users
Auth users live in the `auth` schema and are migrated separately (`auth.users` + `auth.identities`). Password hashes can only be carried over with a database-level dump; if that isn't available, users are re-created by email and sign in with Google or a one-time password reset. Google OAuth must be re-enabled on the new project and the new callback URL added in Google Cloud Console. Same for Microsoft (Excel sync).

### 5. Storage
Recreate `bills` and `po-documents` as private buckets, re-apply their storage policies from the existing migrations, then copy objects (list objects, download via signed URL, upload to the new project keeping identical paths so existing `image_url` / `file_path` values still resolve).

### 6. Edge functions
Deploy all 34 functions with the CLI (`supabase functions deploy`), carrying over `supabase/config.toml`'s per-function `verify_jwt` settings. Then set every secret on the new project. Two need decisions:
- `LOVABLE_API_KEY` (Lovable AI Gateway) stops working off-platform — `bill-extract`, `generate-insights`, `tally-ai-chat`, `po-extract`, `supplier-invoice-extract` must switch to a direct Gemini or OpenAI key.
- Google/Microsoft OAuth redirect URIs must point at the new function URLs.

### 7. Frontend and clients
- Replace the hardcoded values in `vite.config.ts` with `.env` variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PROJECT_ID`) so the app is deployable anywhere.
- Export the repo to GitHub and host on Vercel/Netlify/Cloudflare with those env vars.
- Re-point the Tally agent's `.env` (`SUPABASE_URL`, anon key) and re-issue agent tokens if the `tally_agents` rows are recreated.
- MCP issuer follows the new project ref automatically once env vars change; re-register the MCP client.

### 8. Cutover and verification
Freeze writes here, do a final data delta copy, switch DNS/hosting, then walk the critical paths: sign-in (email + Google), Gmail connect and sync, bill upload → extract → verify, Tally enqueue → agent poll → voucher delivered, liquidity dashboard, exports. Keep this Cloud project intact and read-only for a couple of weeks as a rollback path.

## Things to know up front

- Lovable Cloud cannot be disconnected from this project. After the move, this project keeps its Cloud backend; your production app runs on yours. Continuing to edit here would edit the old backend unless the frontend is pointed at your project by env vars.
- Service role key and DB password of the current Cloud project are not exposed on Lovable, which is why the CSV fallback exists for step 3.
- Password hashes and any Gmail/Excel refresh tokens are the two things most likely to need re-consent rather than a clean copy.
- Nothing in the app code needs rewriting for the move except: the AI gateway calls, `vite.config.ts` env handling, and agent/MCP configuration.

## Deliverables I will produce here

Since I can't run the CLI against a project I don't hold credentials for, this plan's output in-repo is:
1. A `MIGRATION.md` runbook with the exact commands for every phase, in order.
2. A `scripts/export-data.sql` that emits per-table CSV export statements in dependency order, and a matching `scripts/import-data.md` load order with the trigger-disable/enable wrapper.
3. A `scripts/copy-storage.ts` Deno/Node script that copies both buckets object-by-object between two projects using their service keys.
4. `vite.config.ts` + `.env.example` changed to real env vars.
5. An AI-provider switch in the five AI functions, behind a `GEMINI_API_KEY`/`OPENAI_API_KEY` env var, so they work off-platform.
6. A verification SQL script: row counts per table, RLS check, orphan-FK check, sequence reset.

## Pre-existing build errors to fix first

Four insert calls break typecheck because `company_id` is now required (multi-tenancy migration) and the inserts still pass a bare object:

- `src/pages/Clients.tsx:54` — clients insert
- `src/pages/Quotations.tsx:108` — purchase_orders insert
- `src/pages/RawMaterialInvoices.tsx:93` — approvals insert
- `src/pages/SupplierDashboard.tsx:173` — approvals insert

Fix: pass the current company id (resolved from `company_members`) on each insert, or rely on the `fill_company_id` trigger and cast accordingly. Done as step 0, before the backend move.
