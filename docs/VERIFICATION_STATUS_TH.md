# Verification Status

This file summarizes repository verification status without hardcoding test counts in many places.

## Source of Truth

Use this set first:

- `.github/workflows/ci.yml`
- `artifacts/ci/verification-summary.json`
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/verification-contract.json`
- `artifacts/ci/lint.log`
- `artifacts/ci/test.log`
- `artifacts/ci/doctor.log`
- `artifacts/ci/security-check.log`
- `artifacts/ci/readiness.log`
- `artifacts/ci/smoke.log`

## Local Command Set

Commands used on this workstation:

```bash
npm run lint
npm run test:policy
npm test
npm run doctor
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

Closest local equivalent to CI:

```bash
npm run ci:verify
```

## Reading Rule

- if a claim is backed by code path, test, and artifact, treat it as `verified`
- if a claim is backed by code only, treat it as `implemented`
- if a claim depends on SCUM client state, Windows session state, or external infrastructure, treat it as `runtime-dependent`

## Current Local Runtime Notes

On this workstation as of `2026-03-17`:

- the runtime boots with `TENANT_DB_TOPOLOGY_MODE=schema-per-tenant`
- default tenant `1259096998045421672` is provisioned at PostgreSQL schema `tenant_1259096998045421672`
- repo text surfaces pass `lint:text`, and user-facing Thai command/leaderboard strings are covered by `test/mojibake-regression.test.js`
- watcher is `ready` against the real `SCUM.log`
- console-agent is `ready` and preflight passes against the live `SCUM` window
- one live agent command was observed in `SCUM.log`
- live delivery-audit rows exist under `tenant_1259096998045421672."DeliveryAudit"` after the cutover
- live native delivery proof matrices were observed from `SCUM.db` for `Water_05l`, `BakedBeans`, `Emergency_bandage`, `Weapon_M1911`, `Weapon_AK47`, `Magazine_M1911`, `Backpack_02_01`, `Cal_7_62x39mm_Ammobox`, and representative `teleport_spawn` / `announce_teleport_spawn` wrapper profiles

Summary evidence:

- [assets/live-runtime-evidence.md](./assets/live-runtime-evidence.md)
- [assets/live-native-proof-coverage-summary.md](./assets/live-native-proof-coverage-summary.md)

## What This File Still Does Not Prove

- native proof coverage for every SCUM server configuration or every workstation/runtime
- a second verified native-proof environment; pending targets are tracked in `assets/live-native-proof-environments.json`
- the partial `EnableSpawnOnGround=True` sample and the blocked same-workstation `rcon` attempt are tracked as evidence, but neither is counted as a second verified environment
- a second live tenant-topology deployment on another workstation/environment
- any `database-per-tenant` deployment evidence
- behavior on another workstation without the same Windows session, SCUM client, `SCUM.db`, and `SCUM.log` paths
