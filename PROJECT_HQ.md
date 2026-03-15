# Project HQ

[![CI](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/ci.yml)
[![Release](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml/badge.svg)](https://github.com/kogawz1997/Scum-bot-discord-Full-/actions/workflows/release.yml)

เอกสารนี้ใช้สรุปสถานะระบบ, ข้อจำกัด, งานที่ปิดแล้ว, และงานที่ยังต้องทำต่อ

อัปเดตล่าสุด: **2026-03-15**

อ้างอิงหลัก

- ภาพรวม repo: [README.md](./README.md)
- verification status: [docs/VERIFICATION_STATUS_TH.md](./docs/VERIFICATION_STATUS_TH.md)
- evidence map: [docs/EVIDENCE_MAP_TH.md](./docs/EVIDENCE_MAP_TH.md)
- architecture: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- release notes: [docs/releases/README.md](./docs/releases/README.md)
- migration / rollback / restore: [docs/MIGRATION_ROLLBACK_POLICY_TH.md](./docs/MIGRATION_ROLLBACK_POLICY_TH.md)

## 1. สถานะปัจจุบัน

### ใช้งานได้แล้ว

- split runtime `bot / worker / watcher / admin web / player portal / console-agent`
- PostgreSQL cutover บนเครื่องนี้
- provider-aware Prisma toolchain และ isolated test database/schema
- admin auth: DB login, Discord SSO, 2FA, step-up auth, session revoke, security events
- delivery: queue, retry, dead-letter, timeline, evidence, simulator, preflight, capability test
- tenant foundation: tenant-tagged commerce/delivery, quota, billing/license shape, API key/webhook, tenant config API

### ยังไม่ครบ

- admin web ยังไม่ครอบทุก setting ใน env/config
- tenant isolation ยังเป็น application-level scope ไม่ใช่ per-tenant database หรือ RLS
- game-side delivery verification ยังไม่ใช่ inventory-native proof ทุกกรณี

### ยังขึ้นกับ runtime ภายนอก

- `agent mode` ยังขึ้นกับ Windows session, SCUM admin client, และ patch เกม
- restore ยังต้องทำใน maintenance window และยังมี manual confirmation

## 2. สิ่งที่ปิดแล้วรอบล่าสุด

- cut over runtime จาก SQLite ไป PostgreSQL บนเครื่องนี้
- เพิ่ม helper สำหรับ local PostgreSQL cluster และ cutover script
- แก้ test runner ให้ใช้ isolated schema/database ตาม provider จริง
- แยก tenant scope เข้าถึง admin user/session/config routes มากขึ้น
- ลด noisy logs ของ admin web ตอนทดสอบ
- แก้ interaction tests ที่เคยเปิด admin web ค้างจน test ดูเหมือน hang

## 3. ข้อจำกัดที่ยังต้องพูดตรง ๆ

- current `.env` บนเครื่องนี้ใช้ `DELIVERY_EXECUTION_MODE=rcon`
- agent mode ยังมีในระบบ แต่การยืนยัน live command ต้องพึ่งเครื่องที่มี SCUM admin client จริง
- tenant-scoped admin ยังไม่ใช่ full isolation ทุก collection ในระบบ
- เอกสารบางส่วนยังไม่มี screenshot, GIF, หรือ image export ประกอบ

## 4. หลักฐานที่ควรใช้

- CI badges จาก workflow จริง
- `artifacts/ci/verification-summary.json`
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/*.log`
- integration tests ใน `test/`

อย่าใช้อ้างอิงจาก:

- ตัวเลข test count ที่เขียนค้างไว้ในเอกสาร
- ข้อความ “พร้อมใช้” ที่ไม่มี log หรือ test รองรับ

## 5. งานถัดไป

### P1

- ขยาย tenant isolation ให้ถึง config/admin boundary ทุกจุดที่ยังหลุด
- ย้าย setting สำคัญที่ยังอยู่ใน env เข้า admin web ให้มากขึ้น
- เพิ่ม game-side evidence หลัง delivery ให้ลึกกว่า command-level verification

### P2

- เพิ่ม screenshot dashboard จริงและ demo GIF
- เพิ่มภาพ architecture export
- ปรับ release notes ให้ต่อเนื่องทุกรอบ release

### P3

- วาง path สำหรับ managed PostgreSQL ภายนอก local cluster
- ขยาย partner/reseller onboarding ให้ละเอียดขึ้น

## 6. เช็กลิสต์ก่อนขึ้นจริง

- ใช้ `NODE_ENV=production`
- ใช้ `PERSIST_REQUIRE_DB=true`
- ใช้ `PERSIST_LEGACY_SNAPSHOTS=false`
- ตรวจ split origin, OAuth redirect, 2FA, step-up auth
- รัน `npm run doctor`
- รัน `npm run security:check`
- รัน `npm run readiness:prod`
- รัน `npm run smoke:postdeploy`

## 7. สรุป

ภาพรวมตอนนี้คือระบบหลักใช้งานได้, runtime บนเครื่องนี้ย้ายมา PostgreSQL แล้ว, tenant boundary เริ่มเข้าไปถึง admin/config path แล้ว, และชุดตรวจหลักผ่าน แต่ยังมีงานต่อในเรื่อง tenant isolation ให้ลึกขึ้น, config coverage ใน admin web, และหลักฐานเชิงภาพสำหรับ handoff/ขายงาน
