# Google OAuth Setup — Per-User Gmail Connection

This app uses **per-user OAuth** to let each MSME connect their own Gmail inbox for PO/invoice automation. Follow this guide to configure Google Cloud and prepare for verification.

## 1. Google Cloud project

1. Go to https://console.cloud.google.com/ and create a project (or pick an existing one).
2. **Enable APIs**: APIs & Services → Library → enable **Gmail API**.

## 2. OAuth consent screen

APIs & Services → OAuth consent screen.

- **User type**: External
- **App name**: your product name
- **User support email**: your support inbox
- **App logo**: your logo (required for verification)
- **App home page**: `https://bizcraft-stream.lovable.app`
- **Privacy policy URL**: `https://bizcraft-stream.lovable.app/privacy`
- **Terms of service URL**: `https://bizcraft-stream.lovable.app/terms`
- **Authorised domains**: `lovable.app` (and any custom domain you've added)
- **Developer contact**: your email

### Scopes

Add these three scopes:

| Scope | Type |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | **Restricted** |
| `https://www.googleapis.com/auth/userinfo.email` | Non-sensitive |
| `https://www.googleapis.com/auth/userinfo.profile` | Non-sensitive |

The `gmail.readonly` scope is **restricted** — you must complete brand verification + a CASA security assessment before going live. See section 5.

### Test users (pilot phase)

While in **Testing** mode you can add up to 100 test users (their Gmail addresses) and they can connect immediately without verification. Use this for the hackathon / pilot.

## 3. OAuth credentials

APIs & Services → Credentials → Create Credentials → OAuth client ID.

- **Application type**: Web application
- **Name**: e.g. `Lovable Gmail Connector`
- **Authorised JavaScript origins**:
  - `https://id-preview--d9e42d37-c9e3-4eaa-8d50-e3da268f97b7.lovable.app`
  - `https://bizcraft-stream.lovable.app`
  - any custom domain you use
- **Authorised redirect URI** (must match exactly):
  - `https://pskuxhpfohmxlhmupeoz.supabase.co/functions/v1/gmail-auth-callback`

Copy the **Client ID** and **Client Secret** into the project secrets:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

(Both are already set in this project.)

## 4. State signing secret

The OAuth `state` parameter is HMAC-signed to prevent CSRF and to bind the OAuth response to the originating user. The signing key is stored as `OAUTH_STATE_SECRET` (already set).

## 5. Going to Production — Verification checklist

To move from **Testing** to **In production** with the restricted `gmail.readonly` scope:

1. **Brand verification**: app logo, name, support email, privacy & terms URLs all live and accessible.
2. **Domain verification**: verify your published domain (and any custom domain) in Google Search Console using the Google account that owns the OAuth client.
3. **In-app disclosure**: the privacy page (`/privacy`) explicitly describes Gmail data use, retention, and deletion — already included.
4. **Limited Use compliance**: confirm in writing during submission that Gmail data is used only to provide user-facing features, never sold, never used for ads.
5. **CASA assessment**: required for restricted scopes. Choose an authorised lab from Google's list, run the assessment (4–6 weeks typical), upload the Letter of Verification (LOV) to your verification request.
6. **Submit for verification**: OAuth consent screen → "Publish app" → fill the verification form, upload the demo video showing OAuth + scope use, attach the LOV.

Until verification completes, keep the app in **Testing** and use the test-users list for pilots.

## 6. Local / preview testing

The redirect URI is fixed to the Supabase function URL above and works the same in preview and production. To test:
1. Sign in to the app.
2. Go to `/gmail-integration`.
3. Click **Connect Gmail** — this calls `gmail-auth-start` (with your JWT), gets a signed Google URL, and top-level navigates.
4. Approve in Google's consent screen.
5. Google redirects to `gmail-auth-callback` which verifies state, exchanges code, stores tokens scoped to your `auth.uid()`, then redirects back to `/gmail-integration?success=true`.
