# SYSTEM_UPDATES

อัปเดตล่าสุด: **2026-03-15**

ไฟล์นี้ใช้สรุปสิ่งที่เปลี่ยนในระบบช่วงล่าสุดแบบสั้น ๆ โดยภาพรวมสถานะให้ดูที่ [PROJECT_HQ.md](../PROJECT_HQ.md)

## รอบอัปเดตล่าสุด

### Persistence / database

- runtime บนเครื่องนี้ cut over จาก SQLite ไป PostgreSQL แล้ว
- เพิ่ม helper สำหรับ local PostgreSQL cluster:
  - `npm run postgres:local:setup`
  - `npm run postgres:local:start`
  - `npm run postgres:local:status`
- เพิ่ม cutover script:
  - `npm run db:cutover:postgresql -- --source-sqlite prisma/prisma/production.db`
- เพิ่ม provider-aware Prisma flow สำหรับ `sqlite`, `postgresql`, `mysql`

### Test / validation

- `npm test` ใช้ `scripts/run-tests-with-provider.js`
- ถ้า generated Prisma client เป็น PostgreSQL ชุดทดสอบจะสร้าง isolated schema ใหม่ให้เอง
- ลดความเสี่ยงที่ test จะไปชน runtime database จริง
- แก้ interaction test ที่เคยเปิด admin web ค้างจน test process ไม่ยอมปิด

### Delivery / runtime

- delivery runtime บันทึก `executionMode`, `backend`, `commandPath`, `retryCount`
- agent mode มี circuit breaker และ failover policy
- watcher runtime รายงาน `degraded` แทนการ exit ทันทีเมื่อ `SCUM.log` ไม่พร้อม

### Admin / tenant scope

- admin users และ sessions รองรับ `tenantId`
- tenant-scoped admin ถูกจำกัดไม่ให้แตะ global config/env/restart routes ที่ไม่ควรเข้าถึง
- เพิ่ม tenant config API และ tenant config persistence
- control panel แสดง tenant config ให้กับ tenant-scoped admin ได้

### Docs / evidence

- ปรับเอกสารหลักให้สะท้อน PostgreSQL cutover, tenant boundary, และ validation ปัจจุบัน
- คงแนวทางใช้ CI artifact เป็น source of truth สำหรับสถานะ test

## คำสั่งที่ใช้บ่อยหลังอัปเดตนี้

```bash
npm run lint
npm test
npm run doctor
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

## ข้อจำกัดที่ยังอยู่

- current `.env` บนเครื่องนี้ใช้ `DELIVERY_EXECUTION_MODE=rcon`
- agent mode ยังต้องพึ่ง Windows session และ SCUM admin client จริง
- tenant isolation ยังไม่ใช่ per-tenant database isolation
