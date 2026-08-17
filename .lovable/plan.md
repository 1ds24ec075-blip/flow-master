# Google OAuth setup for your own Supabase backend

Your app uses Google OAuth in two separate places. They migrate differently, so handle them separately.

## 1. Gmail integration (your own credentials — reusable)

The Gmail connector already runs on your own Google Cloud OAuth client, stored as project secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Secret values are encrypted and cannot be read back out of this project, but you own them: open Google Cloud Console → APIs & Services → Credentials, select the existing OAuth 2.0 Web client, and copy the Client ID / reveal the Client Secret there.

Steps on the new backend:
1. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_STATE_SECRET` (any strong random string, new is fine — it only signs in-flight state) as Edge Function secrets on your Supabase project.
2. In the same Google Cloud OAuth client, add the new callback URL under Authorized redirect URIs:
   `https://<new-project-ref>.supabase.co/functions/v1/gmail-auth-callback`
   Keep the old one until cutover is done, then remove it.
3. Keep Authorized domains / your app domain entries as they are if the frontend domain does not change.
4. Scope stays `https://www.googleapis.com/auth/gmail.modify`. Existing refresh tokens in `gmail_integrations` keep working after the data migration because they are bound to the Google client, not to Supabase — no user re-consent needed as long as you reuse the same client ID/secret.

## 2. "Sign in with Google" (currently Lovable-managed — NOT reusable)

Google sign-in on this project uses Lovable's managed OAuth credentials. Those are not yours and cannot be exported. On your own Supabase project you must supply your own client:

1. In the same Google Cloud project, create (or reuse) a Web OAuth client for authentication.
2. Authorized redirect URI: `https://<new-project-ref>.supabase.co/auth/v1/callback`.
3. Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
4. In your Supabase project: Authentication → Providers → Google → enable, paste Client ID + Secret.
5. Set Site URL and Additional Redirect URLs to your app origin(s) so the popup/redirect resolves.

Note: because the auth client changes, Google-linked users are matched by email on restore. If you dump and restore `auth.users` plus `auth.identities` as planned, sessions still need re-login once, but accounts and data stay intact.

## 3. Where this fits in the backend migration

- Do this in Phase 2 (right after the schema/data restore), before deploying edge functions, so `gmail-auth-start` / `gmail-auth-callback` have their secrets present on first invoke.
- Verification after cutover: connect Gmail from a test account end to end, run one manual sync, and do one Google sign-in on the new backend.

## What I need from you

Your new Supabase project ref (and the app origin you'll point at it) so I can write the exact redirect URIs into the migration steps instead of placeholders.
