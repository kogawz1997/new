# Split Origin And 2FA Guide

Use this guide when moving from a shared dev-style setup to a safer production deployment.

## Fast start

Generate split-origin env files plus fresh secrets with:

```bash
npm run security:scaffold-split-env -- --admin-origin https://admin.example.com --player-origin https://player.example.com
```

This writes scaffold files to:

- `.env.production.split`
- `apps/web-portal-standalone/.env.production.split`

Apply those files into live `.env` targets with backup + validation:

```bash
npm run security:apply-split-env -- --write
```

Optional:

- add `--with-readiness` to include `readiness:prod`
- add `--skip-validate` if you only want backup + apply
- omit `--write` to preview only

## One-command activation

If you want the repo to scaffold + apply + validate in one step, use:

```bash
npm run security:activate-split-env -- --admin-origin https://admin.example.com --player-origin https://player.example.com --write --with-readiness
```

Notes:

- omit `--write` for a safe dry-run plan
- add `--with-smoke` to run `smoke:postdeploy` after activation
- add `--use-existing-scaffold` if you already generated `.env.production.split` files and only want to apply them

## Recommended topology

- Admin: `https://admin.example.com/admin`
- Player portal: `https://player.example.com`
- API/webhook/worker internals: loopback or private network only

## Admin hardening env

```env
ADMIN_WEB_ALLOWED_ORIGINS=https://admin.example.com
ADMIN_WEB_SECURE_COOKIE=true
ADMIN_WEB_HSTS_ENABLED=true
ADMIN_WEB_TRUST_PROXY=true
ADMIN_WEB_SESSION_COOKIE_NAME=scum_admin_session
ADMIN_WEB_SESSION_COOKIE_PATH=/admin
ADMIN_WEB_SESSION_COOKIE_SAMESITE=Strict
ADMIN_WEB_SESSION_COOKIE_DOMAIN=admin.example.com
ADMIN_WEB_2FA_ENABLED=true
ADMIN_WEB_2FA_SECRET=<generated-base32-secret>
ADMIN_WEB_SSO_DISCORD_REDIRECT_URI=https://admin.example.com/admin/auth/discord/callback
```

Generate a TOTP secret with:

```bash
npm run security:generate-admin-2fa
```

## Player portal env

```env
WEB_PORTAL_BASE_URL=https://player.example.com
WEB_PORTAL_LEGACY_ADMIN_URL=https://admin.example.com/admin
WEB_PORTAL_SECURE_COOKIE=true
WEB_PORTAL_SESSION_COOKIE_NAME=scum_portal_session
WEB_PORTAL_SESSION_COOKIE_PATH=/
WEB_PORTAL_COOKIE_DOMAIN=player.example.com
WEB_PORTAL_COOKIE_SAMESITE=Lax
```

## Validation commands

```bash
npm run doctor
npm run security:check
npm run readiness:prod
```

## What changed in code

- Admin session cookies now support explicit name/path/domain/samesite.
- Admin default cookie path is `/admin` for tighter isolation.
- Player portal session cookies now support explicit name/path/domain.
- Admin auth provider metadata exposes session cookie config for runtime verification.
