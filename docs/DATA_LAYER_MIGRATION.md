# Data Layer Migration Checklist (JSON -> Prisma)

เอกสารนี้ใช้วางแผนย้าย persistence จาก JSON/KV fallback ไป Prisma แบบปลอดภัยและ rollback ได้

## เป้าหมาย

- ลดความเสี่ยงข้อมูลไม่สอดคล้องจากหลาย storage mode
- ปิด JSON/KV fallback ใน production หลังย้ายครบ
- ทำให้ backup/restore/test มีมาตรฐานเดียวกัน

## สถานะล่าสุด (2026-03-08)

- เสร็จแล้ว: migration checklist + rollback plan
- เสร็จแล้ว: เพิ่ม `PERSIST_REQUIRE_DB` fail-fast ใน runtime persistence
- เสร็จแล้ว: เพิ่มสถานะ persistence ใน `GET /healthz` และ admin snapshot
- เสร็จแล้ว: เพิ่ม integration tests สำหรับ fallback/required-db mode
- เสร็จแล้ว: ย้าย store หลักทั้งหมดเป็น Prisma write-through + startup hydration
- เสร็จแล้ว: ย้าย persistence นอก store:
  - `config-overrides` -> `BotConfig`
  - `delivery queue` -> `DeliveryQueueJob`
  - `delivery dead-letter` -> `DeliveryDeadLetter`
- คงค้าง: เปิด `PERSIST_REQUIRE_DB=true` ใน production และทำ smoke test หลัง deploy

## Scope ปัจจุบัน

- Runtime store หลัก:
  - wallet / shop / purchase
  - ticket / event / bounty
  - stats / weaponStats
  - vip / redeem / link / welcome
  - giveaway / moderation / top-panel / delivery-audit
  - rent bike tables
- Non-store persistence:
  - config overrides
  - delivery queue / dead-letter

## Migration Strategy

1. ย้ายทีละระบบ (vertical slice)
2. ใช้ compatibility layer (อ่าน legacy snapshot + เขียน Prisma)
3. เพิ่ม verification query และ integration tests ทุกจุด
4. มี rollback path ก่อน cutover ทุกครั้ง

## Checklist ต่อระบบ

### 1) Discovery

- [ ] ระบุ source of truth ปัจจุบัน
- [ ] ระบุ schema Prisma เป้าหมาย
- [ ] ระบุ read/write paths ทั้งหมดที่กระทบ

### 2) Implementation

- [ ] เพิ่ม Prisma model + migration
- [ ] เพิ่ม mapper normalize/validate
- [ ] เพิ่ม hydration จาก Prisma + fallback legacy snapshot
- [ ] เพิ่ม queueDbWrite/flush สำหรับความสอดคล้อง

### 3) Data Backfill

- [ ] snapshot backup ก่อนย้าย
- [ ] import ข้อมูลเดิมเข้า Prisma
- [ ] ตรวจ record count/unique key/foreign key

### 4) Verification

- [ ] integration test ครอบคลุม CRUD หลัก
- [ ] e2e flow ธุรกิจหลักผ่าน
- [ ] observability ไม่มี error spike

### 5) Cutover

- [ ] สลับ write path ไป Prisma
- [ ] สลับ read path ไป Prisma
- [ ] monitor 24-48 ชั่วโมง

### 6) Cleanup

- [ ] ลบ code path เก่าที่ไม่ใช้แล้ว
- [ ] ปิด fallback JSON/KV เฉพาะ production
- [ ] อัปเดต runbook/docs

## Rollback Plan

หากหลัง cutover พบ incident ระดับสูง:

1. freeze write endpoint ชั่วคราว
2. restore จาก backup ล่าสุด
3. สลับ feature flag กลับ read/write path เดิม
4. re-run integrity checks
5. ทำ postmortem ก่อน rollout รอบใหม่

## Production Guard แนะนำ

- ตั้ง `PERSIST_REQUIRE_DB=true` ใน production หลังระบบหลักย้ายครบ
- fail fast หาก database backend ใช้งานไม่ได้
- บังคับ smoke test หลัง deploy ทุกครั้ง
