# Fork notes

Private fork of [Cap](https://github.com/CapSoftware/Cap). One custom feature:
sign-in only through the operator's OIDC server, restricted to the operator's
directory. Everything else is upstream.

- Upstream base: see `docs/UPSTREAM_BASE` (a commit; becomes a `cap-vX.Y.Z` tag
  after the first sync).
- Branches: `main` mirrors upstream (fast-forward only). `custom` holds our
  patches. Sync branches are `sync/<tag>`.
- Upgrade procedure: `docs/UPGRADING.md`. Deployment: `deploy/`.
- Hosted on GitHub (`sparko-labs/clip`). CI is GitHub Actions: `.github/workflows/clip-*.yml`.

## How sign-in is restricted

`AUTH_MODE=oidc` changes four things, all server-side:

1. **Only one provider exists.** `authOptions().providers` returns just the
   `oidc` provider (`packages/database/auth/oidc.ts`). Google, Apple, WorkOS and
   email OTP are never constructed, and `/api/auth/{signin,callback}/<other>`
   returns 404.
2. **Membership is checked on every login and every request.**
   `isBlockedAccountEmail` (`packages/database/auth/domain-utils.ts`) now also
   refuses emails outside `OIDC_ALLOWED_EMAIL_DOMAINS`, and it is already called
   for session JWTs, desktop/mobile/extension API keys, agent keys and MCP
   tokens. An empty or invalid allowlist admits nobody.
3. **Deprovisioning is immediate.** `POST/PATCH/DELETE /api/scim/v2/Users`
   (bearer `SCIM_BEARER_TOKEN`) writes the user to `fork_user_access`, bumps
   `authSessionVersion` and deletes or revokes desktop, agent, MCP and
   developer credentials. `isUserAccessDisabled` rejects that user on sessions
   and every bearer path.
4. **Side doors are shut.** Mobile email OTP, org SSO lookup, invites to outside
   emails and guest checkout are refused. Credentialed CORS no longer trusts
   `cap.so` / `cap.link`.

The desktop app holds only a per-user API key. No authorization decision is in
any client, so a modified client gains nothing.

### Identity provider setup

- Redirect URI: `${WEB_URL}/api/auth/callback/oidc`
- Flow: authorization code with PKCE, confidential client, scopes
  `openid profile email`.
- Require user assignment in the IdP application. The app-side allowlist is a
  second line of defence, not the only one.
- The IdP must send `email` and `email_verified: true` in the ID token. Entra ID
  omits `email_verified` by default; add it with an optional claim or a claims
  mapping policy or sign-in will be refused with `OidcEmailUnverified`.
- SCIM: point the IdP's provisioning at `${WEB_URL}/api/scim/v2` with
  `SCIM_BEARER_TOKEN`. Only `active` changes and deletes have an effect; users
  are created on first sign-in.

### Known limits

- Domain-only membership admits any IdP account with a verified email on an
  allowed domain.
- A video marked public is viewable by anyone with the link, by upstream
  design. Set `CAP_VIDEOS_DEFAULT_PUBLIC=false` so new videos default private.
- A stolen API key works until SCIM, the allowlist or a session-version bump
  revokes it.
- `OIDC_LINK_BY_EMAIL` defaults to false. A pre-existing user with the same
  email gets `OAuthAccountNotLinked` until an administrator enables it.

## Environment variables added

| Variable | Where | Purpose |
|---|---|---|
| `AUTH_MODE` | web runtime | `legacy` (default) or `oidc` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | web runtime | provider |
| `OIDC_SCOPES`, `OIDC_PROVIDER_NAME` | web runtime | optional |
| `OIDC_ALLOWED_EMAIL_DOMAINS` | web runtime | comma-separated; required in oidc mode |
| `OIDC_LINK_BY_EMAIL` | web runtime | link to existing users by verified email |
| `SCIM_BEARER_TOKEN` | web runtime | enables `/api/scim/v2` |
| `DESKTOP_UPDATES_BASE_URL` | web runtime | where `manifest.json` lives |
| `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_DESKTOP_URL_SCHEME` | web build | copy and deep link |
| `CAP_BRAND_NAME`, `CAP_BRAND_IDENTIFIER`, `CAP_BRAND_URL_SCHEME`, `CAP_BRAND_EXECUTABLE` | desktop build | identity |
| `CAP_SERVER_URL`, `CAP_UPDATE_ENDPOINT`, `CAP_UPDATER_PUBLIC_KEY` | desktop build | server and updater |
| `CAP_DOWNLOAD_URL`, `CAP_VERSIONS_URL`, `CAP_SUPPORT_URL`, `CAP_DOCS_STORAGE_URL`, `CAP_PRICING_URL`, `CAP_LICENSE_API_BASE` | desktop build | links |

Leave `NEXT_PUBLIC_IS_CAP` unset. That makes `userIsPro()` always true, so
plan limits, watermarks and upgrade prompts never apply, and the desktop
follows `/api/desktop/plan`.

## GitHub Actions configuration

Repository **variables** (Settings, Secrets and variables, Actions, Variables):

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID`, `GAR_LOCATION`, `GAR_REPOSITORY` | Artifact Registry project, region and repository (`clip`) |
| `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER` | printed by `deploy/gcp/setup.sh setup` |
| `UPDATER_PUBLIC_KEY` | contents of the `.key.pub` file from `tauri signer generate` |
| `WEB_URL`, `BRAND_NAME`, `BRAND_IDENTIFIER`, `URL_SCHEME` | optional; default to `https://clip.sparkosol.co`, `ClipSpark`, `com.sparkosol.clipspark`, `clipspark` |

Repository **secrets**:

| Secret | Needed for |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | desktop builds (updater artifacts are signed with it) |
| `SYNC_TOKEN` | upstream sync: fine-grained token with contents, pull requests, issues and workflows write |

Not needed yet (macOS and Windows code signing, add when you buy certificates):
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_FILE`, `WINDOWS_CERTIFICATE`,
`WINDOWS_CERTIFICATE_PASSWORD`. The build scripts sign only when
`SIGN_BUILDS=true`, which the desktop workflow currently sets to `"false"`.

Unsigned builds work. macOS shows "unidentified developer" (right-click, Open, or
`xattr -dr com.apple.quarantine <app>`); Windows shows a SmartScreen warning.

Images are pushed to `<location>-docker.pkg.dev/<project>/clip/{web,media-server}`
with a cleanup policy that keeps one version per image. GitHub's repository
Actions permissions must allow `id-token: write` (default for workflows that
declare it).

## Update downloads

The desktop release job attaches installers and `manifest.json` to a GitHub
Release named after the tag (`desktop-vX.Y.Z`). The web app's update route reads
`DESKTOP_UPDATES_BASE_URL`, set to
`https://github.com/sparko-labs/clip/releases/latest/download`.

## Files changed in upstream code (keep this short)

Auth: `packages/database/auth/{auth-options,domain-utils}.ts`,
`packages/env/server.ts`, `packages/database/{migrate.ts,drizzle.config.ts,package.json}`,
`apps/web/app/(org)/{login,signup,verify-otp}/page.tsx`,
`apps/web/app/api/auth/[...nextauth]/route.ts`,
`apps/web/app/api/mobile/[...route]/route.ts`,
`apps/web/app/api/{utils.ts,desktop/[...route]/root.ts}`,
`packages/web-backend/src/{Auth,AgentAuth}.ts`, `apps/web/lib/mcp-auth.ts`,
`apps/web/lib/organization-provisioning.ts`,
`apps/web/actions/organization/{send-invites,get-organization-sso-data}.ts`,
`apps/web/app/api/webhooks/stripe/route.ts`, `apps/web/app/Layout/AppProviders.tsx`,
`apps/web/utils/public-env.tsx`, `apps/web/app/s/[videoId]/_components/AuthOverlay.tsx`.

Branding and trust: `apps/web/{utils/helpers.ts,utils/cors.ts,proxy.ts,next.config.mjs,Dockerfile}`,
`apps/web/lib/desktop-session.ts`, `apps/web/app/api/desktop/[...route]/session.ts`,
`apps/desktop-gpui/src/*` (see `branding.rs`), `apps/desktop-gpui/build.rs`,
`scripts/{bundle-gpui.mjs,windows-release-signing.ps1}`.

New files: `packages/database/auth/{oidc,access}.ts`, `packages/database/fork/`,
`apps/web/lib/{scim,brand,desktop-updates}.ts`,
`apps/web/app/api/{scim,desktop-updates}/`, `apps/web/app/(org)/login/oidc-sign-in.tsx`,
`apps/desktop-gpui/src/branding.rs`, `.github/workflows/clip-*.yml`, `scripts/ci/`, `deploy/`, `docs/`.

## Database

`fork_user_access` lives in its own migration journal (`__fork_migrations`,
folder `packages/database/fork/migrations`). Upstream migration numbering is
untouched, so syncs never conflict on it. Regenerate with
`bun run --filter @cap/database db:generate:fork`.

## Not branded

In-app prose still says "Cap" (settings pages, onboarding, window titles);
the marketing site is unreachable in self-host mode. Icons are upstream's until
artwork is supplied: replace `apps/desktop/src-tauri/icons/*` and set
`BRAND_ICON_ICO` for the Windows resource.

https://idp.sparkosol.co/auth/oauth2/end-session?client_id=KDxdPWWinIFJpTOnEmErDAjJLeBKYTdS&id_token_hint=eyJhbGciOiJSUzI1NiIsImtpZCI6IjAxYTBlNTMwLWQ5ODUtN2U3NC05ZjExLWU3NGMwYzliZjQ2MyJ9.eyJwaWN0dXJlIjoiaHR0cHM6Ly9pZHAuc3Bhcmtvc29sLmNvL2ZpbGVzL2F2YXRhcnMvZGFkM2NlMjUtZjM2NC00NWYwLTg0ZTEtYzhhYmQyMmEzMGY2IiwiYXV0aF90aW1lIjoxNzkyMDc1MjQ1LCJhY3IiOiIwIiwidXNlcm5hbWUiOiJhcmlzaC5raGFuIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiYXJpc2gua2hhbiIsImF0X2hhc2giOiJVZWozd1BFTTRKcFk2MGtYei0zenh3IiwiaXNzIjoiaHR0cHM6Ly9pZHAuc3Bhcmtvc29sLmNvL2F1dGgiLCJzdWIiOiIwMWEwZTU4ZS0yYzJhLTdkOWEtOTdmMy1hOTdhMDhlMWZhYjAiLCJhdWQiOiJLRHhkUFdXaW5JRkpwVE9uRW1FckRBakpMZUJLWVRkUyIsImlhdCI6MTc5MjEwMzQ3MywiZXhwIjoxNzkyMTM5NDczfQ.Do4yYEheENdWYfXYTODRQEakzgTJIzrSdZ1dr_wS8aX4dZNyWzA0VjFdm3HnCUb7jMhXGQxvRikxpjOl5xjCD3Q8cJNFzZRkHu07c1e_coTafCalLg-uob7Ud0pzjqRfhcuzKp2zz5EyMggSdp4czoZqz22y5-BGEFjyRCweAOeeDPFO-lfpBX1vZO844cMZSj1F4zdT_WfPLsaBVJF-ObHTHU830OFlo2xZhcO30FPZNCCFEZGQn9hfztxrOuuA30BAa417XtgnVLJY0vd8hvWCXkzeLlwz-JFyzWY9xrqwL21yjtwTE5-gmdVTzIjzexU7oE-ntti5YNOXk376GA
