# Project HQ

[![CI](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml)
[![Release](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml)

เอกสารนี้ใช้สรุปสถานะระบบ, ข้อจำกัด, และหลักฐานอ้างอิงของ repo

อัปเดตล่าสุด: **2026-03-15**

อ้างอิงหลัก
- ภาพรวม repo: [README.md](./README.md)
- verification status: [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)
- evidence map: [docs/EVIDENCE_MAP_TH.md](./docs/EVIDENCE_MAP_TH.md)
- release notes: [docs/releases/README.md](./docs/releases/README.md)
- delivery capability matrix: [docs/DELIVERY_CAPABILITY_MATRIX_TH.md](./docs/DELIVERY_CAPABILITY_MATRIX_TH.md)
- architecture: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- limitations / SLA: [docs/LIMITATIONS_AND_SLA_TH.md](./docs/LIMITATIONS_AND_SLA_TH.md)
- migration / rollback / restore: [docs/MIGRATION_ROLLBACK_POLICY_TH.md](./docs/MIGRATION_ROLLBACK_POLICY_TH.md)

## 1. What Works Now

### Core system
- bot, worker, watcher, admin web, player portal, console-agent แยก runtime ได้
- health, topology checks, readiness, smoke ใช้งานได้
- Prisma persistence เป็นเส้นทางหลักของระบบแล้ว

### Admin / auth
- DB login, Discord SSO, 2FA, step-up auth
- security events, session revoke, role matrix, permission matrix
- audit, observability, request trace

### Delivery
- queue, retry, dead-letter, watchdog
- execution abstraction แยก `rcon` กับ `agent`
- preflight ก่อน enqueue สำหรับ agent mode
- timeline, step log, audit, evidence bundle ต่อ order
- simulator, preview, capability test
- circuit breaker และ failover policy ฝั่ง agent

### Restore / config safety
- restore preview
- preview token + expiry
- maintenance gate
- rollback backup
- compatibility layer กับ backup shape รุ่นเก่า

## 2. What Is Partial

- RCON ใช้ได้เป็น execution backend แต่ `spawn` ไม่ได้พิสูจน์ว่าทำงานได้กับทุกเซิร์ฟเวอร์
- admin web ครอบ operational setting ส่วนใหญ่แล้ว แต่ยังไม่ใช่ทุกค่าที่มีใน env/config
- multi-tenant มี foundation, tenant-scoped guard, subscription/license shape แล้ว แต่ยังไม่ใช่ full isolation per tenant

## 3. What Is Experimental Or Ops-Dependent

- agent mode ยังขึ้นกับ Windows session, SCUM admin client, admin channel state, และอาจเปราะกับ patch เกม
- migration path ไป PostgreSQL/MySQL ยังเป็นแผนรองรับระยะต่อไป ไม่ใช่สิ่งที่ switched over แล้ว
- restore แม้จะมี guardrails มากขึ้น แต่ยังควรทำใน maintenance window และยังต้อง manual confirmation

## 4. Known Limitations

- SQLite ใช้ได้ระดับ single instance / single host มากกว่าระบบหลายเครื่อง
- admin web ยังไม่ครบทุก setting
- game-side verification หลัง spawn ยังไม่ใช่ proof ระดับ inventory/native API ทุกกรณี
- screenshot dashboard จริงและ demo GIF ยังไม่ได้ถูก track ใน repo

## 5. Current Production Constraints

- ถ้าใช้ `agent mode` ต้องเปิด SCUM admin client ค้างไว้
- ถ้าใช้ `agent mode` ห้าม lock Windows session
- ห้ามเปิด delivery worker ซ้ำทั้ง `bot` และ `worker`
- production ต้องใช้ `PERSIST_REQUIRE_DB=true` และ `PERSIST_LEGACY_SNAPSHOTS=false`
- ทุก deploy ควรผ่าน `doctor`, `security:check`, `readiness:prod`, `smoke:postdeploy`

## 6. Evidence And Verification

หลักฐานที่ควรใช้อ้างอิง:
- `artifacts/ci/verification-summary.json`
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/test.log`
- `artifacts/ci/smoke.log`
- `test/admin-api.integration.test.js`
- `test/rcon-delivery.integration.test.js`
- `test/scum-webhook.integration.test.js`
- `test/web-portal-standalone.player-mode.integration.test.js`

เอกสารที่สรุปจากหลักฐาน:
- [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)
- [docs/EVIDENCE_MAP_TH.md](./docs/EVIDENCE_MAP_TH.md)

## 7. งานถัดไป

### P1
- เพิ่ม screenshot dashboard จริงและ demo GIF
- เพิ่ม architecture image แบบ export เป็นภาพ
- เพิ่ม game-side evidence ที่ลึกกว่า command-level verification ถ้าทำได้

### P2
- ปิด setting ที่ยังต้องแก้ผ่าน env ให้มาอยู่ใน admin web มากขึ้น
- วาง migration path จาก SQLite ไป PostgreSQL/MySQL ให้ลงมือได้จริง
- เพิ่ม release notes ต่อ release

## 8. Checklist ก่อนขึ้นจริง

- หมุน secret/token ทั้งหมด
- ตรวจ OAuth redirect และ split-origin ให้ตรง env จริง
- ใช้ `NODE_ENV=production`
- ใช้ `PERSIST_REQUIRE_DB=true`
- ใช้ `PERSIST_LEGACY_SNAPSHOTS=false`
- รัน:
  - `npm run doctor`
  - `npm run doctor:topology:prod`
  - `npm run doctor:web-standalone:prod`
  - `npm run security:check`
  - `npm run readiness:prod`
  - `npm run smoke:postdeploy`

ถ้าใช้ `agent mode`
- เปิด SCUM admin client ค้างไว้
- อย่า lock Windows session
- ตรวจว่าอยู่ admin channel ถูก
- ตรวจว่า teleport target ที่ใช้อยู่ยังถูกต้อง

## 9. สรุป

สรุปสถานะปัจจุบัน:
- ระบบหลักใช้งานได้
- delivery ใช้งานได้ใน `agent mode`
- เอกสารถูกแยกเป็น `works now / partial / experimental / limitations`
- หลักฐานหลักยังเป็น code path, tests, CI artifacts, และ smoke/readiness output
