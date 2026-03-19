# SCUM TH Platform

[![CI](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml)
[![Release](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-2f7d32?style=for-the-badge&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14.25.1-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5.22.0-2D3748?style=for-the-badge&logo=prisma&logoColor=white)

Last updated: **2026-03-18**

SCUM TH Platform is a control plane for a SCUM community stack built around:

- a Discord bot
- an admin web UI
- a player portal
- a worker runtime
- a watcher runtime
- an optional console-agent

If a statement in this repository is not backed by code, tests, CI artifacts, or runtime logs, treat it as supporting context rather than evidence.

## Primary Documents

- Docs index: [docs/README.md](./docs/README.md)
- System status: [PROJECT_HQ.md](./PROJECT_HQ.md)
- Verification status: [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)
- Evidence map: [docs/EVIDENCE_MAP_TH.md](./docs/EVIDENCE_MAP_TH.md)
- Visual assets: [docs/assets/README.md](./docs/assets/README.md)
- Architecture: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Runtime topology: [docs/RUNTIME_TOPOLOGY.md](./docs/RUNTIME_TOPOLOGY.md)
- Worklist: [docs/WORKLIST.md](./docs/WORKLIST.md)
- Product-ready gap matrix: [docs/PRODUCT_READY_GAP_MATRIX.md](./docs/PRODUCT_READY_GAP_MATRIX.md)
- Refactor plan: [docs/REFACTOR_PLAN.md](./docs/REFACTOR_PLAN.md)
- Config matrix: [docs/CONFIG_MATRIX.md](./docs/CONFIG_MATRIX.md)
- Database strategy: [docs/DATABASE_STRATEGY.md](./docs/DATABASE_STRATEGY.md)
- PostgreSQL cutover checklist: [docs/POSTGRESQL_CUTOVER_CHECKLIST.md](./docs/POSTGRESQL_CUTOVER_CHECKLIST.md)
- Delivery capability matrix: [docs/DELIVERY_CAPABILITY_MATRIX_TH.md](./docs/DELIVERY_CAPABILITY_MATRIX_TH.md)
- Migration / rollback / restore: [docs/MIGRATION_ROLLBACK_POLICY_TH.md](./docs/MIGRATION_ROLLBACK_POLICY_TH.md)
- Limits and SLA notes: [docs/LIMITATIONS_AND_SLA_TH.md](./docs/LIMITATIONS_AND_SLA_TH.md)
- Release notes: [docs/releases/README.md](./docs/releases/README.md)
- Release policy: [docs/RELEASE_POLICY.md](./docs/RELEASE_POLICY.md)
- Security policy: [SECURITY.md](./SECURITY.md)
- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)

## What Works Now

### Runtime and topology

- Split processes for `bot`, `worker`, `watcher`, `admin web`, `player portal`, and `console-agent`
- Health endpoints for each runtime
- Topology checks, production checks, smoke checks, and PM2 manifests
- Split origin deployment for admin and player surfaces
- Runtime env parsing now has a dedicated boundary under `src/config/`
- Bot and worker startup wiring now lives under `src/bootstrap/`
- Bot ready/runtime boot logic and community listeners are split under `src/bootstrap/`
- Admin route groups are partly split under `src/admin/api/` and `src/admin/audit/`
- Admin page/static loading, request/body parsing, request routing, access/security/control-panel helpers, live/SSE/metrics helpers, and Discord OAuth client calls are split under `src/admin/runtime/` and `src/admin/auth/`
- Player API groups are partly split under `apps/web-portal-standalone/api/`
- Player portal page routing and canonical redirects now live under `apps/web-portal-standalone/runtime/portalPageRoutes.js`
- Player portal page/static loading, response/security helpers, reward/wheel helpers, and HTTP lifecycle wiring now live under `apps/web-portal-standalone/runtime/`

### Persistence

- PostgreSQL is supported as the active runtime database provider
- Prisma generation and migration commands are provider-aware
- SQLite-to-PostgreSQL cutover tooling exists in-repo
- Tests run against isolated provider-specific databases or schemas instead of the live runtime database
- Tenant DB topology resolver and provisioning script now exist for `shared`, `schema-per-tenant`, and `database-per-tenant`
- Tenant-scoped platform, tenant-config, purchase/shop, delivery persistence, player wallet/account, player portal, community/admin store, and SCUM webhook/community automation paths now resolve Prisma datasource targets through the selected tenant DB topology where tenant context or a default tenant is available
- `schema-per-tenant` is now the repository target for multi-tenant deployments; `database-per-tenant` remains supported for higher-isolation tiers
- This workstation now runs the live runtime with `TENANT_DB_TOPOLOGY_MODE=schema-per-tenant` for default tenant `1259096998045421672`

### Admin and player surfaces

- Admin login from database credentials
- Discord SSO for admin
- TOTP 2FA and step-up auth for sensitive routes
- Session revoke, security events, request trail, audit, and restore preview
- Player portal with wallet, purchase history, redeem, profile, and Steam link flows
- Control panel for a growing subset of runtime and bot settings
- Control panel env metadata now classifies keys by policy and apply mode
- Control panel env writes now return per-key apply summaries and restart guidance instead of a blanket restart-required response
- Backup restore preview/live status now include post-restore verification and persisted rollback status
- Bot and worker entrypoints are now mostly bootstrap/runtime composition
- Admin browser shell/common helpers now live under `src/admin/assets/dashboard-shell.js`
- Admin snapshot/session/form runtime helpers now live under `src/admin/assets/dashboard-runtime.js`
- Admin browser DOM refs, mutable state, and event binding/startup wiring now live under `src/admin/assets/dashboard-dom.js`, `src/admin/assets/dashboard-state.js`, and `src/admin/assets/dashboard-bindings.js`
- Admin server lifecycle/bootstrap wiring now lives under `src/admin/runtime/adminServerLifecycleRuntime.js`
- Player portal helper/auth/route bootstrap wiring now lives under `apps/web-portal-standalone/runtime/portalBootstrapRuntime.js`

### Operations and observability

- Runtime supervisor with per-role status
- Notification center and reconcile findings in admin
- Backup / restore preview and restore guardrails
- CI artifacts for lint, tests, doctor, security checks, readiness, and smoke
- `doctor`, `security:check`, `readiness`, `smoke`, and `doctor:topology` now share one machine-readable report contract when called with `--json`
- `ci:verify` now writes `verification-contract.json` from the shared JSON contract instead of relying only on raw log parsing
- `lint` now covers syntax, text-encoding scan, ESLint, and formatting checks for repo metadata/docs
- User-facing Thai command and leaderboard text is now guarded by `lint:text` plus `test/mojibake-regression.test.js`
- Policy checks now include runtime profile, control-panel config registry, smoke behavior, readiness sequencing, and module docs
- Live runtime proof now exists on this workstation for `console-agent` preflight/execute and watcher `ready` state against a real `SCUM.log`
- Console-agent health/preflight now also expose classified failure reasons, recovery hints, and managed-process auto-restart telemetry
- Watcher health now exposes recent parsed `admin-command` events from the live server log
- Delivery verification now supports a first-party native-proof backend that reads live SCUM save state from `SCUM.db`
- Native proof now supports both inventory delta and world-spawn delta verification on this workstation
- Live runtime evidence now also shows schema `tenant_1259096998045421672` provisioned in PostgreSQL, with delivery-audit writes present under that tenant schema
- First-party native-proof scripts now exist at `scripts/delivery-native-proof-scum-savefile.js` and `scripts/delivery-native-proof-template.ps1`
- Native-proof environment tracking now exists under `docs/assets/live-native-proof-environments.json` and `docs/assets/live-native-proof-coverage-summary.*`

## What Is Partial

- Admin web still does not cover every `.env` or config setting, even though env-catalog writes now return apply summary and restart guidance
- Restore still relies on a guarded maintenance flow rather than fully automatic rollback, even though success now depends on post-restore verification
- Real captures now exist for admin login, authenticated admin dashboard, player landing, player login, authenticated player dashboard, player showcase, and a simple demo GIF under `docs/assets/`
- `src/adminWebServer.js` and `apps/web-portal-standalone/server.js` are now thin bootstrap/composition entrypoints
- `src/admin/dashboard.html` is now a thinner shell, and the browser runtime is split across focused assets under `src/admin/assets/`, though the surface is still large

## What Is Runtime-Dependent

- `agent` delivery execution depends on a live Windows session and a working SCUM client window
- Watcher health depends on a real `SCUM.log` path being present and staying readable
- Some SCUM command behavior still depends on the target server configuration and game patch level

## Known Limitations

- SQLite remains in dev/import/compatibility paths, but it is no longer the target runtime path for this workstation
- Admin web is not yet a full replacement for direct env/config editing
- Native-proof environment coverage is still based on one verified workstation; additional server/workstation captures remain open in `docs/assets/live-native-proof-environments.json`
- A second server-configuration sample (`EnableSpawnOnGround=True`) exists but is only partial, and the same-workstation `rcon` runtime attempt is blocked by `ECONNREFUSED 127.0.0.1:27015`
- This workstation now runs `TENANT_DB_TOPOLOGY_MODE=schema-per-tenant`, but this is still only one verified environment; other workstations and `database-per-tenant` deployments require separate runtime evidence
- Native game-state proof is verified on this workstation through `SCUM.db` for representative spawn-item classes, including representative `ammo` via `Cal_7_62x39mm_Ammobox`, plus representative `teleport_spawn` / `announce_teleport_spawn` wrapper profiles; broader server/workstation coverage is still incomplete
- A capture checklist now exists at [docs/assets/CAPTURE_CHECKLIST.md](./docs/assets/CAPTURE_CHECKLIST.md)

## Evidence

Source of truth for verification status:

- `artifacts/ci/verification-summary.json`
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/verification-contract.json`
- `artifacts/ci/lint.log`
- `artifacts/ci/test.log`
- `artifacts/ci/doctor.log`
- `artifacts/ci/security-check.log`
- `artifacts/ci/readiness.log`
- `artifacts/ci/smoke.log`

Commands used for local verification:

```bash
npm run lint
npm run test:policy
npm test
npm run doctor
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

Latest local verification on this workstation completed on `2026-03-18` with all commands above passing.

Additional live runtime evidence from this workstation:

- watcher `ready` against the configured `SCUM.log`
- console-agent `ready` with successful live preflight
- one live `#Announce` command executed through the agent and observed in `SCUM.log`
- live native proof matrix captured from `SCUM.db` for:
  - `Water_05l`
  - `BakedBeans`
  - `Emergency_bandage`
  - `Weapon_M1911`
  - `Weapon_AK47`
  - `Magazine_M1911`
  - `Backpack_02_01`
  - `Cal_7_62x39mm_Ammobox`
- live wrapper-profile native proof matrix captured from `SCUM.db` for:
  - `teleport_spawn` using `Weapon_M1911`
  - `announce_teleport_spawn` using `Emergency_bandage`
- representative `ammo` proof now passes with `Cal_7_62x39mm_Ammobox`; loose-round IDs `Ammo_762` and `Cal_7_62x39mm` still did not yield a confirmed `SCUM.db` delta on `2026-03-17`

See [docs/assets/live-runtime-evidence.md](./docs/assets/live-runtime-evidence.md).

Environment coverage status is summarized in [docs/assets/live-native-proof-coverage-summary.md](./docs/assets/live-native-proof-coverage-summary.md).

## Architecture Summary

```mermaid
flowchart LR
  A[SCUM.log] --> B[Watcher runtime]
  B --> C[/scum-event webhook]
  C --> D[Bot / Admin Web]
  D --> E[(PostgreSQL)]
  F[Worker] --> E
  F --> G[Delivery runtime]
  G --> H[RCON or Console Agent]
  I[Player Portal] --> E
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for file-level references.

## Quick Start

### Windows quick start

```bash
npm run setup:easy
```

### Prepare local PostgreSQL

```bash
npm run postgres:local:setup
npm run db:generate:postgresql
npm run db:migrate:deploy:postgresql
```

### Cut over from SQLite to PostgreSQL

```bash
npm run db:cutover:postgresql -- --source-sqlite prisma/prisma/production.db
```

## Environment Notes

### Database

```env
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://user:password@127.0.0.1:55432/scum_th_platform?schema=public
PERSIST_REQUIRE_DB=true
PERSIST_LEGACY_SNAPSHOTS=false
```

### Admin web

```env
ADMIN_WEB_SSO_DISCORD_ENABLED=true
ADMIN_WEB_2FA_ENABLED=true
ADMIN_WEB_STEP_UP_ENABLED=true
```

### Delivery-related runtime

```env
DELIVERY_EXECUTION_MODE=agent
SCUM_CONSOLE_AGENT_BASE_URL=http://127.0.0.1:3213
SCUM_CONSOLE_AGENT_TOKEN=put_a_strong_agent_token_here
SCUM_WATCHER_ENABLED=true
SCUM_LOG_PATH=Z:\\SteamLibrary\\steamapps\\common\\SCUM Server\\SCUM\\Saved\\Logs\\SCUM.log
SCUM_CONSOLE_AGENT_REQUIRED=false
DELIVERY_NATIVE_PROOF_MODE=required
DELIVERY_NATIVE_PROOF_TIMEOUT_MS=15000
DELIVERY_NATIVE_PROOF_WAIT_FOR_STATE_MS=15000
DELIVERY_NATIVE_PROOF_POLL_INTERVAL_MS=1500
```

### Web Setup (Admin Web + Player Portal) แบบละเอียด

#### Admin Web (แนะนำสำหรับ production)

โฟลเดอร์ admin web: `src/adminWebServer.js` (รันผ่าน runtime bot)

ตัวอย่าง `.env` ที่แนะนำ (ปรับโดเมน/พอร์ตตามของจริง):
```env
ADMIN_WEB_HOST=0.0.0.0
ADMIN_WEB_PORT=3200

# CSRF hardening / origin allowlist
ADMIN_WEB_ENFORCE_ORIGIN_CHECK=true
ADMIN_WEB_ALLOWED_ORIGINS=https://admin.genz.noah-dns.online
ADMIN_WEB_TRUST_PROXY=true

# Cookie security
ADMIN_WEB_SECURE_COOKIE=true
ADMIN_WEB_HSTS_ENABLED=true
ADMIN_WEB_SESSION_COOKIE_NAME=scum_admin_session
ADMIN_WEB_SESSION_COOKIE_PATH=/admin
ADMIN_WEB_SESSION_COOKIE_SAMESITE=Strict

# Auth hardening (แนะนำเปิด)
ADMIN_WEB_2FA_ENABLED=true
ADMIN_WEB_2FA_SECRET=put_a_strong_totp_secret_here
ADMIN_WEB_STEP_UP_ENABLED=true

# ถ้าเปิด Discord SSO สำหรับ admin
ADMIN_WEB_SSO_DISCORD_ENABLED=true
ADMIN_WEB_SSO_DISCORD_CLIENT_ID=...
ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET=...
ADMIN_WEB_SSO_DISCORD_REDIRECT_URI=https://admin.genz.noah-dns.online/admin/auth/discord/callback
ADMIN_WEB_SSO_DISCORD_GUILD_ID=...
```

#### Player Portal (แนะนำสำหรับ production)

โฟลเดอร์ portal: `apps/web-portal-standalone/` (รันแยก process)

ตัวอย่าง `.env` (ไฟล์ของ portal) ที่แนะนำ:
```env
WEB_PORTAL_MODE=player
WEB_PORTAL_HOST=0.0.0.0
WEB_PORTAL_PORT=3300

WEB_PORTAL_BASE_URL=https://player.genz.noah-dns.online
WEB_PORTAL_LEGACY_ADMIN_URL=https://admin.genz.noah-dns.online/admin

# Session / cookies
WEB_PORTAL_SESSION_TTL_HOURS=12
WEB_PORTAL_SECURE_COOKIE=true
WEB_PORTAL_COOKIE_SAMESITE=Lax
WEB_PORTAL_ENFORCE_ORIGIN_CHECK=true
WEB_PORTAL_SESSION_COOKIE_NAME=scum_portal_session
WEB_PORTAL_SESSION_COOKIE_PATH=/
WEB_PORTAL_COOKIE_DOMAIN=

# Discord OAuth
WEB_PORTAL_DISCORD_CLIENT_ID=...
WEB_PORTAL_DISCORD_CLIENT_SECRET=...
WEB_PORTAL_DISCORD_REDIRECT_PATH=/auth/discord/callback
```

#### วิธีเช็กว่าตั้งค่าเว็บเสร็จแล้ว

```bash
npm run doctor:web-standalone:prod
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

ถ้า smoke script ใช้ public base url ผ่าน env แยก ให้ตั้ง:
```bat
set SMOKE_ADMIN_BASE_URL=https://admin.genz.noah-dns.online/admin
set SMOKE_PLAYER_BASE_URL=https://player.genz.noah-dns.online
```

For the full env reference, see [docs/ENV_REFERENCE_TH.md](./docs/ENV_REFERENCE_TH.md).
