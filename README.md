# SCUM TH Platform
SCUM control plane with Discord bot, admin web, player portal, delivery worker, and SCUM runtime tooling

[![CI](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml)
[![Release](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-2f7d32?style=for-the-badge&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14.25.1-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5.22.0-2D3748?style=for-the-badge&logo=prisma&logoColor=white)

ถ้าข้อความใดไม่มีไฟล์, test, หรือ artifact รองรับ ให้ถือว่าเป็นคำอธิบายประกอบ ไม่ใช่หลักฐานหลัก

อัปเดตล่าสุด: **2026-03-15**

## 1. วิธีอ่าน repo นี้

- ภาพรวมสถานะและความเสี่ยง: [PROJECT_HQ.md](./PROJECT_HQ.md)
- source of truth สำหรับการตรวจคุณภาพ: [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)
- หลักฐานราย feature: [docs/EVIDENCE_MAP_TH.md](./docs/EVIDENCE_MAP_TH.md)
- release notes: [docs/releases/README.md](./docs/releases/README.md)
- capability matrix ของ delivery: [docs/DELIVERY_CAPABILITY_MATRIX_TH.md](./docs/DELIVERY_CAPABILITY_MATRIX_TH.md)
- สถาปัตยกรรมที่โยงกับไฟล์จริง: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- migration / rollback / restore policy: [docs/MIGRATION_ROLLBACK_POLICY_TH.md](./docs/MIGRATION_ROLLBACK_POLICY_TH.md)
- ข้อจำกัดและ SLA: [docs/LIMITATIONS_AND_SLA_TH.md](./docs/LIMITATIONS_AND_SLA_TH.md)
- changelog: [CHANGELOG.md](./CHANGELOG.md)
- release notes ปัจจุบัน: [docs/releases/v1.0.0.md](./docs/releases/v1.0.0.md)
- เอกสารสาธิตประกอบ: [docs/SHOWCASE_TH.md](./docs/SHOWCASE_TH.md)

## 2. What Works Now

### Core bot / economy
- wallet / ledger / transfer / gift
- shop / cart / purchase / refund / redeem / VIP
- daily / weekly / welcome pack / wheel
- ticket / bounty / event / giveaway

### Runtime / operations
- split runtime `bot / worker / watcher / admin web / player portal / console-agent`
- health checks, topology checks, readiness, smoke
- PM2 / Windows helper / production guardrails

### Admin / portal
- admin web มี RBAC, DB login, Discord SSO, 2FA, step-up auth
- admin web มี audit, observability, backup / restore preview, notification center
- player portal แยก path และ runtime ออกจาก admin แล้ว

### Delivery
- queue / retry / dead-letter / watchdog / audit
- timeline / status history / step log ต่อ order
- preflight / simulator / capability test
- execution backend split เป็น `rcon` หรือ `agent`
- post-spawn verification policy
- evidence bundle ต่อ order

### Agent mode ที่ทดสอบผ่านใน environment นี้
- `#Announce`
- `#TeleportToVehicle 50118`
- `#SpawnItem Weapon_M1911 1`
- multi-item delivery
- magazine `StackCount 100`

## 3. What Is Partial

- `RCON delivery` ใช้ได้เป็น backend แต่ความสามารถเรื่อง `#SpawnItem` ยังขึ้นกับพฤติกรรมของเซิร์ฟเวอร์ปลายทาง
- `admin web` ครอบ setting เชิงปฏิบัติการส่วนใหญ่แล้ว แต่ยังไม่ใช่ทุก setting ในระบบ
- `multi-tenant` มี foundation และ tenant-scoped guard แล้ว แต่ยังไม่ใช่ isolation แบบแยกฐานข้อมูลต่อ tenant
- `post-spawn verification` แข็งแรงในระดับ command, audit, output, timeline แต่ยังไม่ใช่ game-native inventory proof ทุกกรณี

## 4. What Is Experimental Or Ops-Dependent

- `agent mode` ยังพึ่ง Windows session, SCUM admin client, focus ของช่อง command, และอาจเปราะกับ patch เกม
- การย้ายจาก SQLite ไป PostgreSQL/MySQL ยังเป็น migration path ไม่ใช่สิ่งที่ implement แล้วใน production path
- restore flow ปลอดภัยขึ้นมาก แต่ยังควรทำใน maintenance window และยังมี manual confirmation หลายจุด

## 5. Known Limitations

- SQLite เหมาะกับ single-host / low-concurrency มากกว่าการ scale หลายเครื่อง
- admin web ยังไม่ครบทุก setting ที่มีใน env/config
- screenshot dashboard จริงยังไม่ได้ถูก commit ใน repo ตอนนี้
- demo GIF ยังไม่มีใน repo ตอนนี้
- architecture diagram แบบไฟล์ภาพยังไม่มีใน repo ตอนนี้

## 6. Current Production Constraints

- ถ้าใช้ `agent mode` ต้องเปิด SCUM admin client ค้างไว้
- ถ้าใช้ `agent mode` ห้าม lock Windows session
- ถ้าจะแยก `bot` กับ `worker` จริง ห้ามเปิด delivery worker ซ้ำทั้งสองฝั่ง
- production ต้องใช้:
  - `NODE_ENV=production`
  - `PERSIST_REQUIRE_DB=true`
  - `PERSIST_LEGACY_SNAPSHOTS=false`
- ทุก deploy ควรรัน:
  - `npm run doctor`
  - `npm run security:check`
  - `npm run readiness:prod`
  - `npm run smoke:postdeploy`

## 7. Evidence

หลักฐานที่มีใน repo ตอนนี้:
- CI summary: [`artifacts/ci/verification-summary.json`](./artifacts/ci/verification-summary.json)
- human-readable CI report: [`artifacts/ci/verification-summary.md`](./artifacts/ci/verification-summary.md)
- smoke logs: [`artifacts/ci/smoke.log`](./artifacts/ci/smoke.log)
- test logs: [`artifacts/ci/test.log`](./artifacts/ci/test.log)
- delivery capability matrix: [docs/DELIVERY_CAPABILITY_MATRIX_TH.md](./docs/DELIVERY_CAPABILITY_MATRIX_TH.md)
- evidence map: [docs/EVIDENCE_MAP_TH.md](./docs/EVIDENCE_MAP_TH.md)

หลักฐานที่ยังไม่มีใน repo ตอนนี้:
- screenshot dashboard จริง
- demo GIF
- architecture diagram export เป็นภาพ

## 8. Architecture Summary

```mermaid
flowchart LR
  A[SCUM.log] --> B[Watcher runtime]
  B --> C[/scum-event webhook]
  C --> D[Bot / Admin Web]
  D --> E[(Prisma / SQLite)]
  F[Worker] --> E
  F --> G[Delivery runtime]
  G --> H[RCON or Console Agent]
  I[Player Portal] --> E
```

runtime ที่ใช้จริง:
- `bot`
- `worker`
- `watcher`
- `admin web`
- `player portal`
- `console agent`

รายละเอียดแบบโยงกับไฟล์จริงดูที่ [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

## 9. Quick Start

### Windows แบบเร็ว

```bash
npm run setup:easy
```

สคริปต์จะช่วย:
- copy env template
- ติดตั้ง dependencies
- generate Prisma client
- db push

### ติดตั้งแบบ manual

```bash
npm install
copy .env.example .env
npm run doctor
```

ถ้าจะเตรียมขึ้น production:

```bash
copy .env.production.example .env
```

## 10. ค่า `.env` สำคัญ

### Discord

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
```

### Database

```env
DATABASE_URL="file:./prisma/dev.db"
PERSIST_REQUIRE_DB=true
PERSIST_LEGACY_SNAPSHOTS=false
```

หมายเหตุ:
- production ต้องใช้ `PERSIST_REQUIRE_DB=true`
- production ไม่ควรใช้ legacy snapshot เป็น persistence หลัก
- SQLite เหมาะกับ single-host มากกว่า multi-node

### Agent mode

```env
DELIVERY_EXECUTION_MODE=agent
SCUM_CONSOLE_AGENT_BASE_URL=http://127.0.0.1:3213
SCUM_CONSOLE_AGENT_TOKEN=put_a_strong_agent_token_here
DELIVERY_AGENT_COMMAND_DELAY_MS=600
DELIVERY_AGENT_POST_TELEPORT_DELAY_MS=2000
DELIVERY_MAGAZINE_STACKCOUNT=100
DELIVERY_AGENT_TELEPORT_MODE=vehicle
DELIVERY_AGENT_TELEPORT_TARGET=50118
```

ดูตัวแปรเต็มที่ [docs/ENV_REFERENCE_TH.md](./docs/ENV_REFERENCE_TH.md)

## 11. การรันระบบ

### แยก process

```bash
npm run start:bot
npm run start:worker
npm run start:watcher
npm run start:scum-agent
npm run start:web-standalone
```

### PM2

```bash
npm run pm2:start:local
npm run pm2:start:prod
```

Windows helpers:
- `deploy\\start-production-stack.cmd`
- `deploy\\reload-production-stack.cmd`
- `deploy\\stop-production-stack.cmd`

## 12. การทดสอบระบบส่งของ

### preview command

```bash
npm run preview:spawn -- --game-item-id Weapon_M1911 --quantity 1
```

### ยิงคำสั่งผ่าน agent ตรง ๆ

```bash
npm run scum:agent:exec -- --command "#Announce HELLO"
npm run scum:agent:exec -- --command "#TeleportToVehicle 50118"
npm run scum:agent:exec -- --command "#SpawnItem Weapon_M1911 1"
```

### multi-item ตัวอย่าง

```text
#TeleportToVehicle 50118
#SpawnItem Weapon_M1911 1
#SpawnItem Magazine_M1911 2 StackCount 100
#SpawnItem Cal_45_Ammobox 1
```

## 13. Admin Web

สิ่งที่มีตอนนี้:
- config editor
- delivery runtime
- delivery preview / timeline / step log
- preflight / simulator / capability tester
- queue / dead-letter / detail / command log
- notification center
- backup / restore / snapshot export
- audit / observability / request trace

## 14. Player Portal

รองรับ:
- Discord login
- profile / steam link
- wallet / purchase history
- shop / redeem
- player-only mode แยกจาก admin

## 15. Item / Icon / Command Mapping

แหล่งข้อมูลหลัก:
- [scum_weapons_from_wiki.json](./scum_weapons_from_wiki.json)
- [scum_item_category_manifest.json](./scum_item_category_manifest.json)
- [scum_items-main/index.json](./scum_items-main/index.json)

ลำดับ resolve command:
1. `delivery.auto.itemCommands`
2. wiki weapon fallback
3. manifest fallback

## 16. Health / Readiness

```bash
npm run doctor
npm run doctor:topology
npm run doctor:web-standalone
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

ดูสถานะจริงจาก CI ที่ [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)

## 17. Verification Status

source of truth สำหรับผลตรวจคือ:
- [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)
- [`artifacts/ci/verification-summary.json`](./artifacts/ci/verification-summary.json)
- [`artifacts/ci/verification-summary.md`](./artifacts/ci/verification-summary.md)

อย่าใช้ตัวเลข test count ที่เขียนค้างในเอกสารอื่นเป็นหลักฐานหลัก

## 18. Production Cautions

- หมุน token/secret จริงทั้งหมดก่อนเปิดใช้งาน
- ถ้าใช้ `agent mode` อย่า lock session Windows
- อย่ารัน delivery worker ซ้ำทั้ง `bot` และ `worker`
- ถ้าจะ restore production ให้ใช้ preview, confirmation, maintenance gate ทุกครั้ง

## 19. เอกสารเสริม

- คู่มือปฏิบัติการ: [docs/OPERATIONS_MANUAL_TH.md](./docs/OPERATIONS_MANUAL_TH.md)
- customer onboarding: [docs/CUSTOMER_ONBOARDING.md](./docs/CUSTOMER_ONBOARDING.md)
- deployment story: [docs/DEPLOYMENT_STORY.md](./docs/DEPLOYMENT_STORY.md)
- repo structure: [docs/REPO_STRUCTURE_TH.md](./docs/REPO_STRUCTURE_TH.md)
- env profiles: [docs/ENV_PROFILES_TH.md](./docs/ENV_PROFILES_TH.md)
