# Migrating off Lovable Cloud to your own Supabase project

## The constraint

Once Lovable Cloud is enabled on a project it cannot be disconnected or repointed at an external Supabase project. So the migration is a **fork**: a fresh Lovable project (or your own repo outside Lovable) connected to your Supabase account, with the schema, data, functions and secrets moved across. This project keeps running untouched until you cut over.

Two viable targets — pick one:

- **A. New Lovable project + Supabase connector** — you keep building in Lovable, but the backend is your Supabase org (own dashboard, own billing, own instance sizing, SQL editor, PITR, read replicas).
- **B. Self-hosted repo** — export code to GitHub, run Vite yourself (Vercel/Netlify), point it at your Supabase project. Full control, no Lovable runtime.

## What has to move

| Piece | Size here | How it moves |
| --- | --- | --- |
| Schema | 59 migration files | Re-run migrations in order against the new project |
| Data | all business tables | `pg_dump --data-only` export from Cloud, `psql` restore |
| Edge functions | 32 functions + `_shared` | Deploy from the repo with the Supabase CLI |
| Storage | `bills`, `po-documents` (private) | Recreate buckets + policies, copy objects via a script |
| Auth users | Google + email/password accounts | Export `auth.users`, re-import; passwords survive, OAuth links re-establish on next sign-in |
| Secrets | ~18 project secrets | Re-entered by hand in the new project (values are never readable from here) |
| AI calls | 8 functions use Lovable AI | Must be swapped to a direct provider key (see below) |

## Migration sequence

1. **Create the target Supabase project** in your own org, correct region and instance size, and note its URL / anon key / service-role key / DB password.
2. **Export the schema and data from Cloud.** Use Cloud → Advanced → Export data for the dataset, and take the 59 migrations from `supabase/migrations/` as the schema source of truth. Verify row counts per table before and after.
3. **Apply schema** to the new project: migrations in filename order, then confirm every `public` table has its GRANTs, RLS enabled, and the same policies (the hardened `authenticated`-only model, `anon` revoked).
4. **Restore data** with foreign-key-safe ordering (masters → documents → line items → ledger/queue tables). Disable the ledger/liquidity triggers during load so restoring invoices doesn't duplicate ledger entries and liquidity line items, then re-enable them.
5. **Recreate storage** buckets `bills` and `po-documents` as private, copy objects, reapply bucket policies, and re-check that signed-URL reads work from the app.
6. **Deploy edge functions** with the Supabase CLI (`supabase functions deploy`), carrying `config.toml` verify_jwt settings verbatim — the agent endpoints (`tally-agent-poll`, `tally-agent-report`, `gmail-webhook`) intentionally run without JWT verification and rely on their own token/OIDC checks.
7. **Re-enter secrets** in the new project, then rebind: Google OAuth client (add the new callback URL and new project's auth callback), Microsoft/Excel OAuth, Gmail Pub/Sub push endpoint, SMTP credentials, and the Tally agent token.
8. **Replace Lovable AI** in the 8 AI functions (`bill-extract`, `process-po`, `smart-segregation`, `generate-insights`, `tally-ai-chat`, `cash-crisis-predictor`, `morning-brief`, `gmail-connector-sync`). Outside Lovable there is no `LOVABLE_API_KEY`, so these need a direct Gemini (or OpenAI) key and the gateway base URL swapped for the provider's endpoint.
9. **Reconfigure the frontend**: `VITE_SUPABASE_URL` / anon key / project ref, the MCP issuer URL (`src/lib/mcp/index.ts` hardcodes the current project ref), and the Tally agent's `.env`.
10. **Verify before cutover**: sign in with Google, upload and extract a bill, generate Tally XML, run a Gmail sync, mint an agent token and push one voucher, then run a security scan on the new backend.
11. **Cut over**: freeze writes on the old backend, re-export the delta, point DNS/published URL at the new deployment, keep Cloud read-only as a rollback for a week.

## Things that will bite

- **Auth user IDs must be preserved.** Rows all over the schema reference `auth.users` ids; import users with their original UUIDs or every ownership link breaks.
- **Triggers duplicate data on restore.** The ledger, liquidity and mismatch-alert triggers fire on INSERT — load with them disabled.
- **Google OAuth** needs the new project's auth callback added to the Google console before anyone can sign in on the new backend.
- **Gmail Pub/Sub** push subscription points at the old function URL and must be re-pointed, or webhook-driven sync silently stops.
- **Secrets can't be read out of here** — the service-role key and DB password of the Cloud backend are not retrievable, so anything derived from them has to be regenerated on the new side.
- **This project stays on Cloud.** Restoring an old version does not remove Cloud; the fork is the only path.

## What I need from you to start

Which target (A or B), and whether you want me to prepare the migration artifacts here — a consolidated schema SQL file, an ordered data-load script with trigger toggles, a storage copy script, and a secrets checklist — so you can run them against your Supabase project.
