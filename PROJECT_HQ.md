# SCUM TH Bot - Project HQ

![Node.js](https://img.shields.io/badge/Node.js-20%2B-2f7d32?style=for-the-badge&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14.25.1-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5.22.0-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![Tests](https://img.shields.io/badge/tests-97%2F97%20passing-15803d?style=for-the-badge)
![Status](https://img.shields.io/badge/status-production%20baseline%20ready-0f766e?style=for-the-badge)

เอกสารนี้คือศูนย์กลางสถานะของโปรเจกต์ ใช้สรุปสิ่งที่เสร็จแล้ว, สิ่งที่ยืนยันใช้งานได้จริง, ความเสี่ยงที่ยังเหลือ, และแผนถัดไป

อัปเดตล่าสุด: **2026-03-13 22:59 +07:00**

อ้างอิงหลัก
- ภาพรวม/วิธีใช้: [README.md](./README.md)
- คู่มือปฏิบัติการ: [docs/OPERATIONS_MANUAL_TH.md](./docs/OPERATIONS_MANUAL_TH.md)
- คู่มือ `.env` ทุกไฟล์: [docs/ENV_REFERENCE_TH.md](./docs/ENV_REFERENCE_TH.md)
- รายงาน gap ของ env ปัจจุบัน: [docs/PRODUCTION_ENV_GAP_TH.md](./docs/PRODUCTION_ENV_GAP_TH.md)
- คู่มือแอดมินใช้งานประจำวัน: [docs/ADMIN_DAILY_OPERATIONS_TH.md](./docs/ADMIN_DAILY_OPERATIONS_TH.md)

---

## 1. สถานะระบบปัจจุบัน

### ภาพรวม
- ระบบหลักพร้อมใช้งานจริงแล้ว
- data layer ฝั่งหลักย้ายเข้าชั้น service และ Prisma แล้วในระดับที่ใช้งาน production ได้
- split runtime `bot / worker / watcher / web / console-agent` ใช้งานได้จริง
- delivery ที่ใช้งานได้จริงใน environment นี้คือ `agent mode`

### ผลตรวจล่าสุด
- `npm run lint` ผ่าน
- `npm test` ผ่าน `97/97`
- doctor / topology / portal doctor / readiness tooling มีครบ

### สถานะ production baseline
- `PERSIST_REQUIRE_DB=true` รองรับแล้ว
- `PERSIST_LEGACY_SNAPSHOTS=false` รองรับแล้ว
- startup guard / topology guard / security check มีแล้ว
- one-click / PM2 / Windows helper มีแล้ว

---

## 2. สิ่งที่ยืนยันใช้ได้จริงแล้ว

### Discord / Core economy
- wallet / ledger
- shop / cart / purchase
- VIP / redeem / refund / gift
- daily / weekly / welcome pack / wheel
- ticket / bounty / event / giveaway

### SCUM integration
- watcher parse `join / leave / kill / restart`
- kill feed มี `weapon / distance / hit zone / sector`
- webhook retry / dead-letter / dedupe
- restart scheduler / announce

### Rent Bike
- queue ทีละออเดอร์
- daily limit 1 ครั้ง/วัน
- midnight reset / cleanup
- Prisma persistence

### Admin Web
- login / RBAC
- backup / restore / snapshot export
- Audit Center
- observability / metrics / cards
- delivery runtime / preview / detail / test-send
- deep filters / exact match / sort / cursor pagination / shared presets

### Player Portal
- Discord login
- dashboard / wallet / purchase history
- shop / redeem / profile / steam link
- player-only mode แยกจาก admin web แล้ว

### Delivery
- queue + retry + dead-letter + audit + watchdog
- worker hydrate queue จาก Prisma ข้าม process ได้
- command preview ใช้งานได้
- delivery profile รายสินค้าใช้งานได้
- teleport mode `player | vehicle`
- multi-item delivery ใช้งานได้
- magazine auto `StackCount 100` ใช้งานได้

---

## 3. สิ่งที่พิสูจน์สดใน environment นี้แล้ว

### พิสูจน์กับ SCUM จริง
ผ่าน `agent mode` และ SCUM admin client ที่เปิดค้างไว้

สิ่งที่ทดสอบผ่านแล้ว
- `#Announce ...`
- `#TeleportToVehicle 50118`
- `#SpawnItem Weapon_M1911 1`
- multi-item ต่อเนื่อง:
  - `Weapon_M1911`
  - `Magazine_M1911`
  - `Cal_45_Ammobox`
- magazine spawn พร้อม `StackCount 100`

ข้อสรุปเชิงเทคนิค
- `BattlEye RCon` ในเซิร์ฟเวอร์นี้ใช้เช็ก transport / players ได้
- แต่ `#SpawnItem` ไม่ execute ได้จริงผ่าน RCon ตรง
- ดังนั้น runtime ที่ใช้จริงต้องเป็น `agent mode`

---

## 4. สิ่งที่ปิดงานแล้วระดับสถาปัตยกรรม

### Data layer
- ถอด JSON fallback จาก flow หลักที่เสี่ยง split-brain แล้ว
- `_persist` ไม่ทำหน้าที่เป็น DB backend แฝงแล้ว
- service layer กลางถูกแยกชัดขึ้นสำหรับ
  - shop
  - vip
  - rewards
  - events
  - player ops
  - purchase state machine
  - snapshot / observability / audit

### Runtime separation
- topology guard กัน bot/worker เปิด service ซ้ำ
- health endpoint แยกตาม runtime
- PM2 manifest แยกชัด
- Windows helper สำหรับ start/stop/reload มีแล้ว
- ปิด mismatch ของ player portal callback path แล้ว
  - default ปัจจุบันคือ `/auth/discord/callback`
  - admin SSO คงเป็น `/admin/auth/discord/callback`

### Audit / Observability
- audit query/export แยกเป็น service layer แล้ว
- observability query/export แยกเป็น service layer แล้ว
- dashboard cards ใช้ aggregate endpoint + cache window
- shared audit presets เก็บใน DB พร้อม visibility `private / role / public`

---

## 5. ความเสี่ยงที่ยังเหลือ

### 5.1 Agent mode เป็น pragmatic automation ไม่ใช่ API แท้
ความเสี่ยง
- พึ่งพา SCUM client window จริง
- Windows session ต้องไม่ lock
- keyboard/channel state ยังมี sensitivity ตาม client จริง

สถานะ
- ตอนนี้ทำให้เสถียรขึ้นแล้วด้วย
  - serialized execution queue
  - teleport delay แยก
  - submit logic แยกตามชนิดคำสั่ง
  - admin channel switching

### 5.2 ยังไม่ใช่ headless server-side delivery 100%
- ถ้าในอนาคต SCUM รองรับ remote execution channel ที่ดีกว่านี้ ควรย้ายออกจาก admin client bridge

### 5.3 เอกสาร deploy ยังต้องอิง env จริงก่อนใช้งาน production
- ต้องใส่ OAuth secrets / tokens จริงก่อน `readiness:prod`

---

## 6. งานที่คุ้มสุดถัดไป

### P1 - Delivery hardening เพิ่ม
1. เพิ่ม command profile รายชนิด item มากขึ้น
- magazine / ammo box / consumable / armor
2. เพิ่ม server-side command log analytics
- success/fail by item
- retry hotspots
3. เพิ่ม admin tools สำหรับ bulk retry / selective resend

### P1 - Portal completion
1. เก็บ feature ผู้เล่นให้สมบูรณ์ขึ้น
- missions
- notification center
- richer profile / steam binding UX
2. ปิด BigInt / serialization / API consistency ทุกจุดที่เหลือ

### P2 - Commercial polish
1. architecture image / screenshots / demo GIF
2. repo presentation ให้ขายของได้เร็วขึ้น
3. customer deployment story แบบ one-click/panel-based ให้จบกว่าเดิม

---

## 7. Checklist ก่อนขึ้นจริง

- หมุน secret/token ทั้งหมด
- ใส่ Discord OAuth secret จริง
- ใช้ `NODE_ENV=production`
- ใช้ `PERSIST_REQUIRE_DB=true`
- ใช้ `PERSIST_LEGACY_SNAPSHOTS=false`
- รัน
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
- ตรวจว่า teleport target จริงยังใช้ได้ เช่น `50118`

---

## 8. สรุปสุดท้าย

ถ้าถามว่าโปรเจกต์ตอนนี้อยู่ระดับไหน:
- ไม่ใช่แค่ Discord bot แล้ว
- เป็น operations platform สำหรับเซิร์ฟเวอร์ SCUM ที่มี
  - bot
  - worker
  - watcher
  - admin web
  - player portal
  - observability
  - automated delivery ผ่าน agent mode

ถ้าถามว่าอะไรคือสถานะจริงที่สุดตอนนี้:
- ระบบหลักพร้อมใช้งาน
- delivery ใช้งานได้จริงแล้วใน `agent mode`
- production baseline พร้อม แต่ยังต้องใส่ secret จริงของ environment ก่อนเปิดใช้งานเต็มรูปแบบ
