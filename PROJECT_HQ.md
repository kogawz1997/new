# Project HQ

[![CI](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml)
[![Release](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml)

Last updated: **2026-03-17**

This document is the working status register for the repository. It should stay factual. Do not use it as a sales page.

## Reference Set

- Repository overview: [README.md](./README.md)
- Docs index: [docs/README.md](./docs/README.md)
- Verification status: [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)
- Evidence map: [docs/EVIDENCE_MAP_TH.md](./docs/EVIDENCE_MAP_TH.md)
- Architecture: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Runtime topology: [docs/RUNTIME_TOPOLOGY.md](./docs/RUNTIME_TOPOLOGY.md)
- Worklist: [docs/WORKLIST.md](./docs/WORKLIST.md)
- Refactor plan: [docs/REFACTOR_PLAN.md](./docs/REFACTOR_PLAN.md)
- Config matrix: [docs/CONFIG_MATRIX.md](./docs/CONFIG_MATRIX.md)
- Database strategy: [docs/DATABASE_STRATEGY.md](./docs/DATABASE_STRATEGY.md)
- PostgreSQL cutover checklist: [docs/POSTGRESQL_CUTOVER_CHECKLIST.md](./docs/POSTGRESQL_CUTOVER_CHECKLIST.md)
- Migration / rollback / restore: [docs/MIGRATION_ROLLBACK_POLICY_TH.md](./docs/MIGRATION_ROLLBACK_POLICY_TH.md)
- Release policy: [docs/RELEASE_POLICY.md](./docs/RELEASE_POLICY.md)
- Release notes: [docs/releases/README.md](./docs/releases/README.md)

## Current State

### Closed

- Runtime is split into `bot`, `worker`, `watcher`, `admin web`, `player portal`, and `console-agent`
- This workstation has already cut over the runtime database to PostgreSQL
- Prisma tooling is provider-aware and test-safe
- Runtime env parsing has a dedicated boundary under `src/config/`
- Bot and worker startup wiring has been moved into `src/bootstrap/`
- Bot ready/runtime boot logic and community listeners have been extracted from the main entry file
- Bot interactions and ops-alert routing have been extracted from the main entry file
- Admin auth includes DB login, Discord SSO, TOTP 2FA, step-up auth, session revoke, and security event logging
- Admin route groups are partly split under `src/admin/api/` and `src/admin/audit/`
- Admin page/static loading, request/body parsing, request routing, access/security/control-panel helpers, live/SSE/metrics helpers, security export helpers, and Discord OAuth client calls are split out of the main server entry file
- Player API groups are partly split under `apps/web-portal-standalone/api/`
- Player portal page routing, canonical redirects, env/body/player helper assembly, response/security helpers, and canonical runtime helpers now have dedicated runtime modules
- Player portal page/static loading, reward/wheel helpers, and HTTP lifecycle wiring now have dedicated runtime modules
- Production validation commands exist and CI artifacts are written on every verification run
- Validation scripts now share one machine-readable runtime status contract via `--json`
- `ci:verify` now emits a contract-driven `artifacts/ci/verification-contract.json`
- `lint` now includes syntax, encoding, ESLint, and docs/metadata formatting checks
- User-facing Thai command and leaderboard text is now guarded by the repo encoding scan plus `test/mojibake-regression.test.js`
- Policy checks now cover runtime profile parsing, control-panel env registry rules, smoke behavior, readiness ordering, and module docs
- Tenant scope exists across core platform, commerce, and audit surfaces
- Tenant DB topology resolver/provisioning now exists for `schema-per-tenant` and `database-per-tenant`
- Tenant-scoped platform, tenant-config, purchase/admin-commerce, delivery persistence, player/account-wallet, player portal, community/admin store, and SCUM webhook/community automation paths now resolve Prisma datasource targets through the selected tenant DB topology where tenant context or a default tenant is present
- `schema-per-tenant` is now the repository target for multi-tenant deployments; `database-per-tenant` remains supported for higher-isolation tiers
- This workstation now boots with live `TENANT_DB_TOPOLOGY_MODE=schema-per-tenant` for default tenant `1259096998045421672`, and schema `tenant_1259096998045421672` is provisioned in PostgreSQL
- This workstation has live `console-agent` proof: preflight passes against a real `SCUM` window and a live command reached the game log
- This workstation has live watcher proof: watcher reports `ready` against a real `SCUM.log` path and exposes recent parsed `admin-command` events
- Delivery verification now has a first-party native-proof backend that reads `SCUM.db`
- This workstation has live native delivery proof from game state for `Water_05l`, `BakedBeans`, `Emergency_bandage`, `Weapon_M1911`, `Weapon_AK47`, `Magazine_M1911`, `Backpack_02_01`, `Cal_7_62x39mm_Ammobox`, and representative `teleport_spawn` / `announce_teleport_spawn` wrapper profiles
- First-party native-proof scripts now exist at `scripts/delivery-native-proof-scum-savefile.js` and `scripts/delivery-native-proof-template.ps1`
- Native-proof environment tracking now exists in `docs/assets/live-native-proof-environments.json` and `docs/assets/live-native-proof-coverage-summary.md`
- Admin browser shell/common helpers are extracted under `src/admin/assets/dashboard-shell.js`
- Admin snapshot/session/form browser runtime is extracted under `src/admin/assets/dashboard-runtime.js`
- Admin browser DOM refs, mutable state, and event binding/startup wiring are extracted under `src/admin/assets/dashboard-dom.js`, `src/admin/assets/dashboard-state.js`, and `src/admin/assets/dashboard-bindings.js`
- Admin server lifecycle/bootstrap wiring is extracted under `src/admin/runtime/adminServerLifecycleRuntime.js`
- Player portal helper/auth/route bootstrap wiring is extracted under `apps/web-portal-standalone/runtime/portalBootstrapRuntime.js`

### Partial

- Admin web still does not expose every env/config switch
- Restore remains a controlled maintenance workflow with confirmation gates
- Exported diagrams, authenticated admin/player dashboard captures, and a simple demo GIF now exist under `docs/assets/`, but broader in-game evidence still depends on live runtime capture

### Runtime-dependent

- `agent` execution still depends on Windows session state and a real SCUM client window
- Watcher readiness depends on an actual `SCUM.log` path
- Some live SCUM command behavior remains server-dependent

## Current Workstation Notes

- Database provider in `.env`: `postgresql`
- Runtime database endpoint: `127.0.0.1:55432`
- `TENANT_DB_ISOLATION_MODE=postgres-rls-strict`
- `TENANT_DB_TOPOLOGY_MODE=schema-per-tenant`
- `PLATFORM_DEFAULT_TENANT_ID=1259096998045421672`
- Admin origin: `https://admin.genz.noah-dns.online/admin`
- Player origin: `https://player.genz.noah-dns.online`
- `DELIVERY_EXECUTION_MODE` in `.env`: `agent`
- `DELIVERY_NATIVE_PROOF_MODE` in `.env`: `required`
- `SCUM_WATCHER_ENABLED=true`
- `SCUM_LOG_PATH` in `.env`: `Z:\SteamLibrary\steamapps\common\SCUM Server\SCUM\Saved\Logs\SCUM.log`
- `SCUM_CONSOLE_AGENT_REQUIRED=false`

These are machine-specific notes. Keep them aligned with the active env when this workstation changes.

## Validation Notes

Current validation stack:

- `npm run lint`
- `npm run test:policy`
- `npm test`
- `npm run doctor`
- `npm run security:check`
- `npm run readiness:prod`
- `npm run smoke:postdeploy`

Important detail:

- `readiness:prod` now includes `smoke:postdeploy`
- `smoke:postdeploy` no longer treats required runtimes as healthy based only on HTTP 200 and `{ ok: true }`
- optional runtimes such as a disabled watcher or an optional console-agent are reported without failing the run
- the latest local full pass on this workstation completed on `2026-03-17`
- the latest live schema-per-tenant runtime pass on this workstation completed on `2026-03-17` with `npm test` and `node scripts/readiness-gate.js --production`
- a targeted provider-backed tenant-topology suite covering admin/community/player/webhook paths also passed locally on `2026-03-17`

## Remaining Non-Delivery Gaps

Use [docs/WORKLIST.md](./docs/WORKLIST.md) as the only detailed backlog.

Short form:

- expand native delivery proof evidence beyond the current live workstation matrix and server configuration; the representative delivery-class matrix now includes `ammo` via `Cal_7_62x39mm_Ammobox`, and per-class guidance exists in `docs/DELIVERY_NATIVE_PROOF_COVERAGE.md`

## Review Warnings

- Do not claim `database-per-tenant` is the active runtime here; this workstation is `schema-per-tenant`
- Do not claim another workstation/environment is already verified for the same tenant topology without separate runtime evidence
- Do not claim every setting is editable from admin web
- Do not claim agent execution is independent of Windows and SCUM client state
- Do not claim native proof coverage for every delivery type or every server environment yet
- Do not treat `docs/assets/live-native-proof-environments.json` as multi-environment proof until pending entries are replaced with verified captures
- Do not treat the partial `EnableSpawnOnGround=True` sample or the blocked same-workstation `rcon` attempt as a second verified environment
- Do not use hardcoded test counts in documents; use CI artifacts instead

## Summary

The repository is in reviewable shape: PostgreSQL runtime is in place, this workstation now runs the tenant topology in live `schema-per-tenant` mode, validation commands are wired, and the main documentation set points back to evidence. The remaining work is concentrated in broader live native-proof coverage across more environments, not missing core infrastructure.
