# SCUM TH Platform

SCUM control plane สำหรับ Discord bot, admin web, player portal, delivery worker, watcher, และ console-agent

[![CI](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml)
[![Release](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-2f7d32?style=for-the-badge&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14.25.1-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5.22.0-2D3748?style=for-the-badge&logo=prisma&logoColor=white)

อัปเดตล่าสุด: **2026-03-15**

ถ้าข้อความใดไม่มีไฟล์, test, หรือ artifact รองรับ ให้ถือเป็นคำอธิบายประกอบ ไม่ใช่หลักฐานหลัก

## เอกสารหลัก

- ภาพรวมสถานะ: [PROJECT_HQ.md](./PROJECT_HQ.md)
- สถานะการตรวจสอบ: [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)
- หลักฐานราย feature: [docs/EVIDENCE_MAP_TH.md](./docs/EVIDENCE_MAP_TH.md)
- สถาปัตยกรรม: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- capability matrix ของ delivery: [docs/DELIVERY_CAPABILITY_MATRIX_TH.md](./docs/DELIVERY_CAPABILITY_MATRIX_TH.md)
- migration / rollback / restore: [docs/MIGRATION_ROLLBACK_POLICY_TH.md](./docs/MIGRATION_ROLLBACK_POLICY_TH.md)
- ข้อจำกัดและ SLA: [docs/LIMITATIONS_AND_SLA_TH.md](./docs/LIMITATIONS_AND_SLA_TH.md)
- release notes: [docs/releases/README.md](./docs/releases/README.md)

## What Works Now

### Core runtime

- แยก process เป็น `bot`, `worker`, `watcher`, `admin web`, `player portal`, `console-agent`
- มี health endpoints, topology checks, readiness, smoke, และ PM2 manifests
- admin/player split origin ใช้งานได้แล้ว

### Persistence

- runtime บนเครื่องนี้ cut over มาใช้ PostgreSQL แล้ว
- มี helper สำหรับ local PostgreSQL cluster, provider-aware Prisma generate/migrate, และ cutover จาก SQLite
- ชุดทดสอบรันบน isolated database/schema แยกจาก runtime จริง

### Admin / portal

- admin web มี DB login, Discord SSO, 2FA, step-up auth, session revoke, security events, audit, observability, backup/restore preview
- player portal แยก runtime ออกจาก admin และมี wallet, purchase history, redeem, profile, steam link
- control panel ปรับค่าฝั่ง bot/delivery/runtime ได้มากขึ้นจากหน้าเว็บ

### Delivery

- queue, retry, dead-letter, watchdog, audit, timeline, step log, evidence bundle
- execution backend แยกชัดว่า order ไหนใช้ `rcon` หรือ `agent`
- preflight, simulator, capability test, post-spawn verification policy
- agent circuit breaker และ failover policy

### Platform / tenant groundwork

- มี tenant, subscription, license, API key, webhook, quota, marketplace, analytics foundation
- tenant-tagged commerce และ delivery audit/evidence ใช้งานได้
- admin tenant scope และ tenant config API มี guard แล้ว

## What Is Partial

- admin web ยังไม่ครอบทุกค่าใน `.env` และ config ทั้งหมด
- multi-tenant ยังไม่ใช่ database isolation ต่อ tenant
- game-side verification หลัง spawn ยังเป็นระดับ command/output/audit ไม่ใช่ inventory-native proof ทุกกรณี
- RCON backend ใช้งานได้ แต่ความสามารถบางคำสั่งยังขึ้นกับเซิร์ฟเวอร์ปลายทาง

## What Is Experimental Or Ops-Dependent

- `agent mode` ยังพึ่ง Windows session, SCUM admin client, admin channel state, และอาจเปราะกับ patch เกม
- restore ยังควรทำใน maintenance window และยังมี manual confirmation
- local PostgreSQL helper เหมาะกับ single-host deployment มากกว่าคลัสเตอร์ production หลายเครื่อง

## Known Limitations

- SQLite ยังมีในเส้นทาง dev/import/compatibility แต่ไม่ใช่เส้นทาง runtime หลักของเครื่องนี้แล้ว
- admin web ยังไม่ครอบทุก setting
- screenshot dashboard จริง, demo GIF, และ architecture image export ยังไม่มีใน repo
- tenant isolation ตอนนี้ยังเป็น application-level scope มากกว่า DB-level isolation

## Current Production Constraints

- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`
- current runtime database บนเครื่องนี้คือ PostgreSQL local cluster ที่ `127.0.0.1:55432`
- current `.env` บนเครื่องนี้ตั้ง `DELIVERY_EXECUTION_MODE=rcon`
- ถ้าจะใช้ `agent mode` ต้องเปิด SCUM admin client ค้างไว้และห้าม lock Windows session
- ห้ามเปิด delivery worker ซ้ำทั้งฝั่ง `bot` และ `worker`

## Current Environment On This Machine

- package name: `scum-th-platform`
- database provider ใน env: `postgresql`
- admin origin: `https://admin.genz.noah-dns.online/admin`
- player origin: `https://player.genz.noah-dns.online`
- admin Discord SSO: เปิดใช้งาน
- test runner: ใช้ `scripts/run-tests-with-provider.js` เพื่อแยก test DB/schema ออกจาก runtime จริง

## Evidence

source of truth สำหรับสถานะการตรวจสอบ:

- `artifacts/ci/verification-summary.json`
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/lint.log`
- `artifacts/ci/test.log`
- `artifacts/ci/doctor.log`
- `artifacts/ci/security-check.log`
- `artifacts/ci/readiness.log`
- `artifacts/ci/smoke.log`

คำสั่งที่ใช้ตรวจแบบ local ในรอบล่าสุด:

```bash
npm run lint
npm test
npm run doctor
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

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

รายละเอียดเพิ่มเติมอยู่ที่ [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

## Quick Start

### Windows แบบเร็ว

```bash
npm run setup:easy
```

### เตรียม PostgreSQL local สำหรับเครื่องนี้

```bash
npm run postgres:local:setup
npm run db:generate:postgresql
npm run db:migrate:deploy:postgresql
```

### cut over จาก SQLite ไป PostgreSQL

```bash
npm run db:cutover:postgresql -- --source-sqlite prisma/prisma/production.db
```

## ค่า `.env` สำคัญ

### Database

```env
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://user:password@127.0.0.1:55432/scum_th_platform?schema=public
PERSIST_REQUIRE_DB=true
PERSIST_LEGACY_SNAPSHOTS=false
```

### Delivery

```env
DELIVERY_EXECUTION_MODE=rcon
SCUM_CONSOLE_AGENT_BASE_URL=http://127.0.0.1:3213
SCUM_CONSOLE_AGENT_TOKEN=put_a_strong_agent_token_here
```

### Admin Web

```env
ADMIN_WEB_SSO_DISCORD_ENABLED=true
ADMIN_WEB_2FA_ENABLED=true
ADMIN_WEB_STEP_UP_ENABLED=true
```

ตัวแปรเต็มดูที่ [docs/ENV_REFERENCE_TH.md](./docs/ENV_REFERENCE_TH.md)
