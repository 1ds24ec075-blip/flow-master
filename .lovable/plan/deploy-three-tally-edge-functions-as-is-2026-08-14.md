# Deploy three Tally edge functions as-is

No code changes. Deploy the current project versions of:

- `tally-enqueue`
- `bill-generate-tally`
- `resolve-item-match`

`tally-agent-poll` and `tally-agent-report` are explicitly excluded.

## Shared module

`supabase/functions/_shared/company-auth.ts` exists in the project (5.1 KB) and is imported by all three functions. Shared files under `_shared/` are bundled automatically with each deploying function, so it ships with all three.

## Steps

1. Deploy the three functions in one batch, unmodified.
2. Report the deploy result for each and the live version reported by the backend.

Switch to build mode to run the deploy.
