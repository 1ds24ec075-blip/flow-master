## Multi-tenant per-user Gmail OAuth

Convert the current single-tenant Gmail integration into a per-user OAuth system where each MSME connects their own inbox, production-ready for public launch.

### Phase 1 — Database

Migration on `gmail_integrations`:
- Add `user_id uuid` referencing `auth.users(id) ON DELETE CASCADE` (nullable for now to preserve the existing row).
- Add unique index on `(user_id, email_address)`.
- Drop the permissive `Allow all operations` policy.
- Add strict per-user RLS policies (SELECT/INSERT/UPDATE/DELETE) using `auth.uid() = user_id`.
- Same treatment on `processed_emails`: add `user_id`, RLS scoped via the parent integration.

### Phase 2 — Edge functions

**`gmail-auth-start`**
- Require caller JWT, extract `user.id`.
- Sign a short-lived `state` token (HMAC with a server secret) containing `{ user_id, nonce, exp }` and pass it in the Google OAuth URL.
- Set `verify_jwt = true` for this function.

**`gmail-auth-callback`**
- Verify the `state` HMAC and expiry; reject on mismatch.
- Exchange code → tokens, fetch userinfo.
- Upsert by `(user_id, email_address)` instead of by email alone.
- Redirect back to `/gmail-integration` with success/error.

**`gmail-sync`**
- Require JWT; load integration by `id` AND `user_id = auth.uid()`.
- Add token refresh: if `token_expires_at` is past, call Google's token endpoint with `refresh_token`, persist new `access_token` + expiry before listing messages.
- Same for `gmail-connector-sync` callsites — keep the Lovable connector path untouched but stop using it for end-user inboxes.

### Phase 3 — Frontend (`src/pages/GmailIntegration.tsx`)
- Require auth; redirect to `/auth` if no session.
- List only the current user's integrations (RLS handles filtering).
- "Connect Gmail" button calls `gmail-auth-start` with the user's JWT, then follows the redirect.
- Show connected email, last sync, sync status, and Disconnect.
- Log connect/disconnect/sync events to `agent_activity_feed`.

### Phase 4 — Auth + legal pages
- Confirm `src/pages/Auth.tsx` works (email/password + Google) — already in place.
- Add `/privacy` and `/terms` route stubs with placeholder MSME-appropriate copy you can edit. Required by Google verification.
- Add a Gmail-specific data-handling disclosure section on `/privacy` (read-only scope, no resale, deletion on disconnect).

### Phase 5 — Google Cloud setup doc
Create `GOOGLE_OAUTH_SETUP.md` covering:
- OAuth consent screen → External, Production.
- Required scopes: `gmail.readonly`, `userinfo.email`, `userinfo.profile`.
- Authorized redirect URI: `https://pskuxhpfohmxlhmupeoz.supabase.co/functions/v1/gmail-auth-callback`.
- Authorized JavaScript origins: preview + published + custom domains.
- App homepage, privacy, and terms URLs to paste in.
- CASA assessment checklist for the restricted `gmail.readonly` scope (4–6 week timeline).
- How to add pilot MSMEs as Test Users while verification is pending.

### Technical notes
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are already in secrets — no new secrets needed.
- A new `OAUTH_STATE_SECRET` will be added for HMAC signing of the `state` parameter.
- The existing single-tenant row in `gmail_integrations` will be left intact with `user_id = null` and excluded from the UI.
- `processed_emails` will be backfilled with `user_id = null` for the existing row; new rows always carry `user_id`.

### Out of scope
- Gmail push notifications (Pub/Sub watch). Polling stays for now.
- Per-user per-mailbox subject-filter customization UI (defaults remain).

Approve and I'll build it.