# SCUM TH Bot - Project HQ

![Node.js](https://img.shields.io/badge/Node.js-20%2B-2f7d32?style=for-the-badge&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14.25.1-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5.22.0-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![Tests](https://img.shields.io/badge/tests-43%2F43%20passing-15803d?style=for-the-badge)
![Security](https://img.shields.io/badge/security%20check-passed-0f766e?style=for-the-badge)

เอกสารนี้คือศูนย์กลางข้อมูลของโปรเจกต์ (Single Source of Truth) ใช้แทน `PROJECT_REVIEW.md` และ `docs/SYSTEM_UPDATES.md`

- อัปเดตล่าสุด: **2026-03-09**
- สถานะระบบ: **พร้อมใช้งานจริง (พร้อม checklist production)**
- สรุปผลตรวจล่าสุด: `npm run check` ผ่าน (43/43), `npm run security:check` ผ่าน
- ไฟล์อ้างอิงหลัก: `README.md`, `src/*`, `test/*`

---

## สารบัญ

- [1) ภาพรวมระบบ](#1-ภาพรวมระบบ)
- [2) สถานะความพร้อมใช้งานจริง](#2-สถานะความพร้อมใช้งานจริง)
- [3) สิ่งที่ทำเสร็จแล้ว (สรุปแบบระบบ)](#3-สิ่งที่ทำเสร็จแล้ว-สรุปแบบระบบ)
- [4) ความปลอดภัย (Security Baseline)](#4-ความปลอดภัย-security-baseline)
- [5) ผลทดสอบล่าสุด](#5-ผลทดสอบล่าสุด)
- [6) Runbook สำหรับใช้งานจริง](#6-runbook-สำหรับใช้งานจริง)
- [7) งานค้าง/แผนต่อไป](#7-งานค้างแผนต่อไป)
- [8) Changelog รวม](#8-changelog-รวม)
- [9) แผนผังไฟล์สำคัญ](#9-แผนผังไฟล์สำคัญ)
- [10) กติกาการอัปเดตเอกสาร](#10-กติกาการอัปเดตเอกสาร)

---

## 1) ภาพรวมระบบ

โปรเจกต์นี้เป็นระบบจัดการเซิร์ฟเวอร์ SCUM ผ่าน Discord Bot + Admin Web โดยมีแกนหลักดังนี้:

- Discord Bot (`src/bot.js`)
- SCUM Log Watcher (`scum-log-watcher.js`)
- Webhook Bridge (`src/scumWebhookServer.js`)
- Admin API + Dashboard (`src/adminWebServer.js`, `src/admin/*`)
- Data Layer (Prisma + SQLite/fallback persistence)
- RCON Delivery Queue + Retry + Audit

```mermaid
flowchart LR
  A[SCUM.log] --> B[Watcher]
  B --> C[Webhook /scum-event]
  C --> D[Discord Bot Services]
  D --> E[Discord Channels]
  D --> F[(SQLite/Persist)]
  G[Admin Dashboard] --> H[Admin API]
  H --> F
  H --> D
```

---

## 2) สถานะความพร้อมใช้งานจริง

| หมวด | สถานะ | หมายเหตุ |
|---|---|---|
| Economy / Shop / Purchase | พร้อม | รองรับสินค้าปกติ + bundle หลายไอเทม |
| RCON Auto Delivery | พร้อม | queue + retry + audit + observability |
| Rent Bike Daily | พร้อม | 1 ครั้ง/วัน, queue ป้องกันชนกัน, reset รายวัน |
| Tickets / Events / Bounty | พร้อม | ปิด ticket แล้วลบห้องอัตโนมัติ |
| Stats / Kill Feed / Leaderboards | พร้อม | รองรับ kill weapon + distance + hit zone |
| Admin Web | พร้อม | login session, rate limit, live updates |
| SCUM Watcher/Webhook | พร้อม | dedupe + retry + dead-letter |
| Security Hardening | พร้อม baseline | มี checklist production ชัดเจน |
| CI / Lint / Test | พร้อม | check, test, security-check ผ่าน |

---

## 3) สิ่งที่ทำเสร็จแล้ว (สรุปแบบระบบ)

### 3.1 Core Bot Features

- ระบบเศรษฐกิจครบ: wallet, daily, weekly, transfer/gift
- ระบบร้านค้า: buy/inventory, purchase log, refund, mark-delivered
- ระบบตะกร้าสินค้าใช้งานได้จริง (`/cart add|view|remove|clear|checkout`)
- ระบบสินค้าแบบ bundle: เพิ่มหลายไอเทมในสินค้าเดียว
- ระบบ Ticket, Event, Bounty, VIP, Redeem
- ระบบ panel command สำหรับโพสต์การ์ด/ปุ่มใช้งาน

### 3.2 Auto Delivery + RCON

- เพิ่ม queue จัดส่งของอัตโนมัติ
- รองรับ retry/backoff เมื่อส่งคำสั่งพลาด
- มี audit log สำหรับตรวจย้อนหลัง
- มี dead-letter queue พร้อม retry/remove เฉพาะรายการ
- มี idempotency guard กัน enqueue/ส่งซ้ำ
- มี watchdog แจ้งเตือน queue ค้างเกิน SLA
- บังคับมาตรฐาน bundle template:
  - สินค้าแบบหลายไอเทมต้องมี `{gameItemId}` หรือ `{quantity}`
  - ถ้าไม่ผ่านจะ reject ตั้งแต่ enqueue

### 3.3 SCUM Integration

- watcher parse log ได้หลายรูปแบบ (join/leave/kill/restart)
- kill event รองรับข้อมูลอาวุธ ระยะ และจุดยิง (hit zone)
- dedupe event กัน spam ซ้ำ
- webhook timeout + retry + dead-letter

### 3.4 Rent Motorbike (Daily)

- จำกัดเช่า 1 ครั้ง/วัน/คน
- ทำงานบน queue ทีละคำสั่ง ลดปัญหาแยก vehicle id ผิด
- เก็บสถานะ rental vehicle สำหรับ cleanup
- มีงาน reset รอบวันตาม timezone ที่กำหนด

### 3.5 Admin Web (ปรับ UX แล้ว)

- มีหน้า login แยกจาก dashboard
- หน้า dashboard แยกหมวดชัดเจน ใช้งานง่ายขึ้น
- รองรับธีม SCUM style (เช่น Tactical / Neon)
- ปรับดีไซน์ใหม่โทน SCUM Tactical แบบเต็มหน้า (จัดระเบียบเมนู/ฟอร์มให้อ่านง่ายขึ้น)
- แสดงสถานะกดปุ่มชัดขึ้น และมี feedback runtime
- มี Danger Zone แยก action เสี่ยง
- รองรับ RBAC แบบ `owner/admin/mod` แยกสิทธิ์ตาม endpoint
- รองรับ 2FA (TOTP) และ Discord SSO (เปิดใช้ผ่าน env)
- รองรับ backup/restore snapshot ผ่าน Admin API (owner only)
- ระบบล็อกอินใช้ฐานข้อมูล `admin_web_users` เป็นแหล่งข้อมูลหลัก (bootstrap จาก env ครั้งแรก)

### 3.6 Observability + Metrics

- มี time-series metrics ใน dashboard:
  - delivery queue length
  - delivery fail rate
  - admin login failures
  - webhook error rate
- มี metrics filter ตามช่วงเวลา (window) ในหน้า dashboard
- มี alert event สำหรับ queue pressure / fail-rate spike / login-failure spike
- route alert ไป Discord ช่องแอดมินอัตโนมัติ (`ops-alert`)
- มี health endpoint สำหรับ monitor ภายนอก (`GET /healthz`)

### 3.7 Item Icons + Mapping

- รองรับ mapping ชื่อไอเทมกับ icon
- รองรับ fallback เมื่อไม่เจอ icon ตรงชื่อ
- รองรับ normalize alias สำหรับอาวุธ/ไอเทม
- ใช้ได้กับ feed/card ที่เกี่ยวข้อง

---

## 4) ความปลอดภัย (Security Baseline)

### 4.1 สิ่งที่ทำแล้ว

- Admin API
  - session auth + token fallback
  - security headers (CSP / frame / referrer / MIME)
  - origin check + sec-fetch-site guard
  - body size limit
  - token compare แบบ timing-safe
- Webhook
  - บังคับ JSON content-type
  - payload size limit
  - timeout + retry
  - secret verify แบบ timing-safe
  - event type whitelist
- Operational
  - เพิ่ม `npm run security:check`
  - ลดความเสี่ยงจาก token query โดยปิด default

### 4.2 ค่า env ที่ควรมีใน production

```env
SCUM_WEBHOOK_SECRET=<strong-random-secret>
SCUM_WEBHOOK_MAX_BODY_BYTES=65536
SCUM_WEBHOOK_REQUEST_TIMEOUT_MS=10000

ADMIN_WEB_PASSWORD=<strong-random-password>
ADMIN_WEB_TOKEN=<strong-random-token>
ADMIN_WEB_ALLOW_TOKEN_QUERY=false
ADMIN_WEB_ENFORCE_ORIGIN_CHECK=true
ADMIN_WEB_MAX_BODY_BYTES=1048576
ADMIN_WEB_TRUST_PROXY=true
ADMIN_WEB_SECURE_COOKIE=true
ADMIN_WEB_HSTS_ENABLED=true
ADMIN_WEB_HSTS_MAX_AGE_SEC=31536000
ADMIN_WEB_ALLOWED_ORIGINS=https://admin.your-domain.com
```

### 4.3 หมายเหตุความปลอดภัย

ไม่มีระบบใด "กันแฮกได้ 100%" แต่ baseline ปัจจุบันลดความเสี่ยงหลักได้มาก (CSRF, brute-force pressure, payload abuse, weak auth config)

---

## 5) ผลทดสอบล่าสุด

วันที่ยืนยันผล: **2026-03-09**

### คำสั่งที่รันจริง

```bash
npm run check
npm run security:check
```

### ผลลัพธ์

- `npm run check` ผ่าน
  - lint ผ่าน
  - test ผ่าน 43/43
- `npm run security:check` ผ่าน (`SECURITY_CHECK: PASSED`)

### Integration tests ที่มีแล้ว

- purchase -> queue -> auto-delivery success
- bundle template validation (placeholder guard)
- admin API auth + validation
- admin RBAC (owner/mod permission matrix)
- admin live update stream + ticket claim/close full flow (e2e)
- discord interaction full flow (button -> modal -> slash dispatch)
- rentbike full flow (rent -> delivered -> daily-limit -> reset -> cleanup)
- watcher parse หลายรูปแบบ (join/leave/kill/restart)
- webhook auth/dispatch flow
- item icon resolver + fallback
- persistence fallback/required-db guards
- config + delivery non-store persistence write-through to Prisma

---

## 6) Runbook สำหรับใช้งานจริง

### 6.1 ติดตั้งและเริ่มระบบ

```bash
npm install
npm start
node scum-log-watcher.js
```

### 6.2 ลงทะเบียน slash commands

```bash
npm run register-commands
```

### 6.3 ก่อน deploy ทุกครั้ง

- [ ] หมุน secret ที่สำคัญ (admin/webhook/rcon)
- [ ] ตรวจ `.env` ครบและปลอดภัย
- [ ] รัน `npm run check`
- [ ] รัน `npm run security:check`
- [ ] รัน `npm audit --omit=dev`
- [ ] ตั้ง `PERSIST_REQUIRE_DB=true` ใน production หลังย้าย data layer ครบ
- [ ] สำรองข้อมูลก่อนปล่อยจริง

### 6.4 Endpoint สำคัญ

- Admin Web: `http://127.0.0.1:3200/admin/login`
- Observability API: `GET /admin/api/observability`
- SCUM Webhook: `POST /scum-event`

---

## 7) งานค้าง/แผนต่อไป

### 7.1 งานที่ปิดแล้ว

- [x] RBAC ละเอียดขึ้น (`owner/admin/mod`)
- [x] backup/restore ผ่าน admin web
- [x] e2e tests: live update + ticket full flow
- [x] metrics dashboard แบบ time-series
- [x] 2FA/SSO สำหรับ admin login
- [x] P0 เสถียรภาพระบบส่งของ: idempotency + dead-letter retry/remove + watchdog
- [x] P1 observability: filter/window + ops alert route + `/healthz`
- [x] P1 e2e เพิ่มเติม: discord interaction full flow + rentbike full flow + restore drill
- [x] Phase 1 (รอบนี้): wallet ledger + purchase status state machine + admin hardening
- [x] Phase 2 (foundation): player account + steam binding sync + player dashboard API
- [x] Phase 3 (foundation): shared coin service สำหรับ `redeem` และ `bounty`
- [x] Phase 2 (portal): player dashboard UI ฝั่งเว็บจริง + authz แยกจาก admin (`/player`)
- [x] Phase 2 (portal): inventory/catalog query-filter สำหรับ player portal
- [x] Phase 3: รวม `rentbike` + `bounty` + `redeem` ผ่าน service กลาง (`playerOpsService`)

### 7.2 งานที่ยังค้าง (ต้องทำต่อ)

#### P0 - ความปลอดภัยก่อนขึ้นจริง

- [x] startup guard (บล็อก config เสี่ยงใน production)
- [x] incident response runbook
- [x] secret generator script
- [x] หมุน `SCUM_WEBHOOK_SECRET`, `ADMIN_WEB_PASSWORD`, `ADMIN_WEB_TOKEN`, `RCON_PASSWORD`
- [ ] หมุน `DISCORD_TOKEN` จาก Discord Developer Portal และอัปเดตใน production env

#### P2 - Data Layer ระยะยาว

- [x] migration checklist + rollback plan (`docs/DATA_LAYER_MIGRATION.md`)
- [x] เพิ่ม `PERSIST_REQUIRE_DB` fail-fast
- [x] เพิ่ม persistence status ใน `/healthz` และ admin snapshot
- [x] เพิ่ม integration tests สำหรับ fallback/required-db mode
- [x] ย้าย `linkStore`, `bountyStore`, `statsStore`, `cartStore`, `redeemStore`, `vipStore`, `scumStore`, `eventStore`, `ticketStore`, `weaponStatsStore`, `welcomePackStore`, `moderationStore`, `giveawayStore`, `topPanelStore`, `deliveryAuditStore` ไป Prisma (cache + startup hydration + write-through)
- [x] ย้าย store หลักที่ยังเป็น JSON ไป Prisma แบบ write-through ครบ
- [x] ย้าย persistence นอก store (`config-overrides`, `delivery queue/dead-letter`) ไป Prisma (`BotConfig`, `DeliveryQueueJob`, `DeliveryDeadLetter`)
- [ ] เปิด `PERSIST_REQUIRE_DB=true` ใน production หลัง migration ครบ

#### Phase 2/3 ที่ยังค้าง

- [x] แยก process bot/web/worker ระดับ runtime flags + worker entrypoint + PM2 manifest
- [ ] แยก process bot/web/worker ใน production environment จริง (ปรับ env + deploy + smoke test)
- [ ] รวม domain service กลางไปคำสั่ง/flow อื่นที่เหลือให้ครบทั้งระบบ

### 7.3 ลำดับทำจริงรอบถัดไป

1. หมุน `DISCORD_TOKEN` จริง แล้ว redeploy ทุก instance
2. ปิด fallback ใน production (`PERSIST_REQUIRE_DB=true`) พร้อม smoke test หลัง deploy
3. แยก process bot/web/worker พร้อม health checks + deploy manifests
4. รวม service กลางเพิ่มเติมให้ครอบคลุม command สำคัญทั้งหมด
5. เพิ่ม integration tests สำหรับ persistence non-store ที่ย้ายล่าสุด (config + delivery queue/dead-letter)

---

## 8) Changelog รวม

### 2026-03-09

- ทำ readiness verification รอบล่าสุดครบชุด:
  - `npm run check` ผ่าน (43/43)
  - `npm run security:check` ผ่าน
  - `npm run doctor` ผ่าน
  - `npm run doctor:web-standalone` ผ่าน
- เพิ่ม hardening ฝั่งเว็บ player portal:
  - ถ้าพอร์ตใช้งานอยู่ (`EADDRINUSE`) จะ `exit(1)` ทันที เพื่อไม่ให้ process ค้างเงียบ
  - กรณี server error อื่น ๆ จะ `exit(1)` เช่นกัน
- ปรับเอกสารให้พร้อมใช้งานจริง:
  - อัปเดต `README.md` เป็นสถานะทดสอบ `43/43`
  - เพิ่มคำสั่ง checklist readiness ก่อนปล่อยจริง
  - เพิ่ม troubleshooting พอร์ตชนใน `apps/web-portal-standalone/README.md`
  - เพิ่มขั้นตอน deploy production ให้เริ่มจาก `.env.production.example`
- ยืนยันว่า doctor production จะ `PASS` เมื่อ override ค่าเป็น production ที่ถูกต้อง
  (`https` + `secure cookie` + `origin check`)

### 2026-03-08

- ปิดงานหลัก Phase 1:
  - เพิ่ม Prisma migration `20260308093000_phase1_wallet_ledger_state_machine`
  - เพิ่ม Prisma migration `20260308123000_cart_entry_store` สำหรับ `CartEntry`
  - เพิ่ม Prisma migration `20260308131500_event_ticket_store` สำหรับ `GuildEvent/GuildEventParticipant/TicketRecord`
  - เพิ่ม Prisma migration `20260308134500_weapon_welcome_store` สำหรับ `WeaponStat/WelcomeClaim`
  - เพิ่ม Prisma migration `20260308143000_moderation_giveaway_top_panel_delivery_audit` สำหรับ `Punishment/Giveaway/GiveawayEntrant/TopPanelMessage/DeliveryAudit`
  - เพิ่ม Prisma migration `20260308170000_config_delivery_persistence` สำหรับ `BotConfig/DeliveryQueueJob/DeliveryDeadLetter`
  - เพิ่มตาราง `WalletLedger`, `PurchaseStatusHistory`, `PlayerAccount`
  - ย้าย store เพิ่มเป็น Prisma write-through: `vip/scum/event/ticket/weaponStats/welcomePack/moderation/giveaway/topPanel/deliveryAudit`
  - ย้าย persistence นอก store ไป Prisma:
    - `src/config.js` -> `BotConfig`
    - `src/services/rconDelivery.js` -> `DeliveryQueueJob` + `DeliveryDeadLetter`
  - เพิ่ม state machine สำหรับสถานะ purchase (`pending/delivering/delivered/delivery_failed/refunded`)
  - บังคับ transition validation ผ่าน `src/services/purchaseStateMachine.js`
  - ทุกการเปลี่ยนสถานะ purchase บันทึก history พร้อม `reason/actor/meta`
  - ทุกการเปลี่ยนยอด wallet ผ่าน ledger audit trail
- Hardening ฝั่ง Admin API:
  - `/admin/api/purchase/status` ตรวจ transition ก่อน update และตอบ `400` พร้อม allowed statuses
  - เพิ่ม `/admin/api/purchase/statuses`
  - เพิ่ม Player APIs:
    - `GET /admin/api/player/accounts`
    - `GET /admin/api/player/dashboard?userId=<discordId>`
    - `POST /admin/api/player/account/upsert`
    - `POST /admin/api/player/steam/bind`
    - `POST /admin/api/player/steam/unbind`
- วางฐาน Phase 2/3:
  - เพิ่ม `src/store/playerAccountStore.js`
  - sync Steam binding จาก `linkStore` ไป `PlayerAccount` อัตโนมัติ
  - เพิ่ม shared `src/services/coinService.js`
  - ย้าย flow `redeem` และ `bounty` มาใช้ coin service กลาง
- ปิดงาน Phase 2/3 เพิ่มเติม:
  - เพิ่ม `src/services/playerOpsService.js` เป็น service กลางสำหรับ `rentbike`/`bounty`/`redeem`
  - ปรับคำสั่ง `/redeem`, `/bounty`, `/rentbike` ให้เรียกผ่าน service กลาง
  - เพิ่ม Player Portal UI จริงที่ `apps/web-portal-standalone/public/player.html`
  - เพิ่ม endpoint ฝั่ง admin สำหรับ player portal:
    - `GET /admin/api/portal/player/dashboard`
    - `GET /admin/api/portal/shop/list`
    - `GET /admin/api/portal/purchase/list`
    - `GET /admin/api/portal/bounty/list`
    - `POST /admin/api/portal/redeem`
    - `POST /admin/api/portal/rentbike/request`
    - `POST /admin/api/portal/bounty/add`
- เดินงานแยก process (Phase 3) เพิ่ม:
  - เพิ่ม runtime flags ใน `src/bot.js` เพื่อเปิด/ปิด service แยกตาม process
  - เพิ่ม worker entrypoint `src/worker.js` (rentbike + delivery worker)
  - เพิ่ม PM2 manifest ตัวอย่าง `deploy/pm2.ecosystem.config.cjs`
  - เพิ่ม env flags แยก bot/worker ใน `.env.example`
- รวม service กลางรอบเพิ่ม:
  - เพิ่ม `setCoinsExact` และ `transferCoins` ใน `src/services/coinService.js`
  - ย้าย flow `/addcoins`, `/removecoins`, `/setcoins`, `/gift`, reward ใน `/event`, และเครดิตใน `/refund` มาใช้ service กลาง
- เพิ่ม worker runtime guard:
  - เพิ่ม `getWorkerRuntimeErrors` และ `assertWorkerEnv` ใน `src/utils/env.js`
  - เพิ่ม test `getWorkerRuntimeErrors` ใน `test/env.test.js`
- เพิ่ม integration tests:
  - `test/wallet-ledger.integration.test.js`
  - `test/player-account.integration.test.js`
  - ขยาย `test/admin-api.integration.test.js` สำหรับ purchase status transition
  - `test/player-ops-service.integration.test.js`
  - `test/admin-portal-api.integration.test.js`
  - `test/cart-redeem-prisma.integration.test.js`
  - `test/vip-event-ticket-scum-prisma.integration.test.js`
  - `test/weapon-welcome-prisma.integration.test.js`
  - `test/moderation-giveaway-top-panel-delivery-audit-prisma.integration.test.js`
  - `test/config-delivery-persistence.integration.test.js`
- ผลทดสอบรอบนี้:
  - `npm run lint` ผ่าน
  - `npm test` ผ่าน `41/41`

### 2026-03-07

- เพิ่มโปรเจคเว็บแยกใหม่ `apps/web-portal-standalone`:
  - Discord OAuth login (`/admin/auth/discord/start` + callback)
  - session + RBAC gate (`owner/admin/mod`)
  - proxy `/admin/api/*` ไป admin API เดิมด้วย `WEB_PORTAL_UPSTREAM_TOKEN`
  - แยก process ออกจากบอทหลัก 100% (ไม่แก้ flow bot runtime เดิม)
  - เพิ่ม production guard + health endpoint + env doctor (`npm run doctor:web-standalone:prod`)
- เดินงาน P2 Data Layer เพิ่ม:
  - ย้าย `src/store/linkStore.js`, `src/store/bountyStore.js`, `src/store/statsStore.js` ให้ใช้ Prisma แบบ write-through
  - เพิ่ม startup hydration จาก Prisma พร้อม fallback โหลด snapshot เดิม
  - เพิ่ม warmup ตอนบอท `ClientReady` (`initLinkStore/initBountyStore/initStatsStore`)
- รีเฟรชเอกสารหลัก:
  - เขียน `README.md` ใหม่เป็น UTF-8 เต็มไฟล์ และอัปเดตสถานะ migration ล่าสุด
- ปิดช่องโหว่การอ่าน request body:
  - เปลี่ยนการตรวจขนาด payload จากตัวอักษรเป็น byte จริงทั้ง `admin-web` และ `scum-webhook`
  - แยกสถานะ error ให้ถูกต้อง (`400` malformed JSON, `413` payload too large)
  - ปรับพฤติกรรมเมื่อ body เกินขนาดให้ drain request โดยไม่ตัด socket ทันที
- Hardening เพิ่มเติมด้านความสุ่ม/ชนกันของรหัส:
  - เปลี่ยนจาก `Math.random()` ไปใช้ `crypto` สำหรับ `purchase code`, `rentbike order id`, `delivery audit id`, และ suffix ticket
  - ปรับสุ่มผู้ชนะ giveaway เป็น Fisher-Yates + `crypto.randomInt`
- เพิ่ม integration tests ด้าน security/runtime:
  - `admin API` ทดสอบ malformed JSON + oversized UTF-8 payload
  - `scum webhook` ทดสอบ malformed JSON + oversized UTF-8 payload
- ยืนยันผลทดสอบรอบนี้:
  - `npm run check` ผ่าน (29/29)
  - `npm run security:check` ผ่าน
  - `npm run doctor` ผ่าน
  - `npm audit --omit=dev` ไม่พบ vulnerability
- Smoke runtime บนเครื่อง:
  - `node src/bot.js` บูตขึ้นและล็อกอิน Discord สำเร็จ (พบพอร์ต `3100`/`3200` ถูกใช้งานอยู่จาก instance เดิม)
  - `node scum-log-watcher.js` เริ่มเฝ้า `SCUM.log` ได้ปกติ
- ปรับเอกสารสถานะใน `PROJECT_HQ.md` ให้เป็นรูปแบบ check-list ชัดเจน:
  - แยกงาน `เสร็จแล้ว` กับ `ค้าง` ตาม P0/P2
  - เพิ่มลำดับทำงานรอบถัดไปแบบ actionable
- ยืนยันผลตรวจล่าสุดซ้ำอีกครั้ง:
  - `npm run check` ผ่าน (27/27)
  - `npm run security:check` ผ่าน
- แก้ mojibake ใน `src/commands/cart.js` ทั้งไฟล์ให้เป็น UTF-8 ไทยล้วน
- เพิ่มคำสั่ง `/panel shop-refresh-buttons`:
  - ใช้ลบปุ่ม `Checkout` แบบเก่าในโพสต์ร้านค้าเดิม (ย้อนหลังตาม limit)
  - ลดปัญหาปุ่มเก่ากดแล้วไม่ตรง flow ใหม่
- อัปเดตหัวข้อ `งานค้าง/แผนต่อไป` เป็น roadmap แบบ `P0/P1/P2` พร้อมลำดับทำงาน
- เพิ่ม production startup guard ใน `src/utils/env.js`
  - ถ้า `NODE_ENV=production` และค่า security baseline ไม่ผ่าน ระบบจะไม่ยอม start
- เพิ่ม script `npm run security:generate-secrets` สำหรับหมุน secret ได้เร็ว
- เพิ่ม runbook `docs/INCIDENT_RESPONSE.md` สำหรับ token leak / webhook abuse / brute-force
- ปิดงาน P0 ความเสถียรระบบส่งของ:
  - เพิ่ม dead-letter queue + retry/remove endpoint
  - เพิ่ม idempotency guard ป้องกันส่งซ้ำ
  - เพิ่ม watchdog alert สำหรับ queue ค้างเกิน SLA
- หมุนค่า secret ใน env สำหรับ webhook/admin/rcon แล้ว (รอหมุน Discord token ทาง portal)
- รีเฟรช slash commands แล้ว (`npm run register-commands`)
- ยืนยันผลตรวจล่าสุด:
  - `npm run lint` ผ่าน
  - `npm test` ผ่าน (27/27)
  - `npm run security:check` ผ่าน
- ปิดงาน P1 observability ฝั่ง production:
  - เพิ่ม query filter สำหรับ `/admin/api/observability` (`windowMs`, `series`)
  - เพิ่มปุ่ม apply window ให้ดึง metrics ตามช่วงเวลาจาก backend
  - เพิ่ม stream event `ops-alert`/`delivery-dead-letter` เข้า live update dashboard
  - เพิ่มส่ง `ops-alert` ไป Discord ช่องแอดมินจากตัวบอท
  - เพิ่ม health endpoint `GET /healthz` สำหรับ external monitor
- เพิ่ม integration assertions สำหรับ backup/restore drill:
  - backup snapshot
  - mutate data
  - dry-run restore
  - live restore และตรวจความถูกต้องของข้อมูลหลัง restore
- แก้ข้อความระบบ rent bike ที่เพี้ยน (mojibake) ให้เป็นข้อความปกติใช้งานจริง
- เพิ่ม `rentbike e2e` ด้วย fake RCON:
  - flow ครบ: rent -> delivered -> daily-limit -> midnight reset -> vehicle cleanup
  - ทดสอบผ่านใน `npm test`
- เพิ่ม `discord interaction e2e` ครบชุด:
  - button `panel-verify-open` -> modal
  - modal `panel-verify-modal` (invalid steam id path)
  - slash command dispatch + execute path
  - แยก `handleInteractionCreate` ออกให้ทดสอบได้โดยไม่ต้อง login bot จริง
- เพิ่ม `PERSIST_REQUIRE_DB` fail-fast ใน `src/store/_persist.js`
  - ถ้าเปิด require mode แล้วหา `sqlite3` ไม่เจอ ระบบจะหยุดทันที
  - ถ้าไม่เปิด require mode จะ fallback เป็น JSON พร้อม reason ชัดเจน
- เพิ่ม persistence observability:
  - `GET /healthz` ส่ง `persistence` status
  - admin snapshot ส่ง `persistence` status
- เพิ่ม persist integration tests:
  - fallback mode เมื่อไม่มี sqlite3
  - required-db mode ต้อง fail fast
- รีดีไซน์หน้า Admin Web / Login ใหม่ทั้งชุดให้โทน SCUM Tactical (ยังคงทุกฟังก์ชันเดิม)
- ปรับระบบล็อกอินแอดมินให้ตรวจสอบผู้ใช้จากฐานข้อมูล `admin_web_users` โดยตรง
  - bootstrap ผู้ใช้เริ่มต้นจาก env เฉพาะตอนเริ่มต้นระบบ
  - เก็บรหัสผ่านเป็น hash แบบ `scrypt`

### 2026-03-06

- รวมเอกสารกระจัดกระจายเป็นไฟล์เดียว `PROJECT_HQ.md`
- ปรับเอกสารให้เป็น UTF-8 ชัดเจน ไม่มีข้อความเพี้ยน
- ยืนยันผลตรวจล่าสุด:
  - `npm run check` ผ่าน
  - `npm run security:check` ผ่าน
- ตั้งกติกาอัปเดตเอกสารให้เขียนที่ไฟล์นี้ไฟล์เดียว
- ปิดงานใหญ่ครบ 5 รายการ:
  - RBAC owner/admin/mod
  - backup/restore ผ่าน admin web
  - e2e tests live update + ticket full flow
  - metrics dashboard แบบ time-series
  - 2FA/SSO สำหรับ admin login
- Hardening รอบล่าสุด:
  - ปรับ `scripts/security-check.js` ให้ตรวจเข้มขึ้น
  - ตรวจว่า `.env` ไม่ถูก track โดย git
  - บังคับเงื่อนไขเพิ่มเมื่อ `NODE_ENV=production`
  - อัปเดต `.gitignore` ให้กันไฟล์ runtime (`data/backups/`, `data/*.json`, `logs/`)
  - ล้าง mojibake ในไฟล์ env และเพิ่ม guard ตรวจ encoding ครอบคลุมมากขึ้น
  - ปรับระบบตะกร้าให้ใช้งานจริง และตัดปุ่ม `ชำระเงิน` ออกจากการ์ดสินค้าใหม่ (คงรองรับข้อความเก่าแบบย้อนหลัง)

### ก่อนหน้า (รอบสำคัญ)

- ปรับ UX admin dashboard ให้จัดหมวดชัด
- เพิ่มระบบ RCON queue + retry + audit
- เพิ่ม rentbike daily flow + cleanup/reset
- เพิ่ม watcher hardening + dedupe/dead-letter
- เพิ่ม integration tests ครอบคลุม flow สำคัญ
- เพิ่ม security hardening สำหรับ admin/webhook

---

## 9) แผนผังไฟล์สำคัญ

- Bot entry: `src/bot.js`
- Admin server: `src/adminWebServer.js`
- Admin UI: `src/admin/dashboard.html`, `src/admin/login.html`
- Webhook server: `src/scumWebhookServer.js`
- Watcher: `scum-log-watcher.js`
- RCON delivery: `src/services/rconDelivery.js`
- Rent bike service: `src/services/rentBikeService.js`
- Config: `src/config.js`
- Tests: `test/*.test.js`
- Security check script: `scripts/security-check.js`

---

## 10) กติกาการอัปเดตเอกสาร

ตั้งแต่ตอนนี้เป็นต้นไป:

- ให้ใช้ไฟล์นี้เป็นไฟล์หลักเพียงไฟล์เดียว
- ทุกครั้งที่อัปเดตระบบ ให้เขียนรายละเอียดในหัวข้อ:
  - What changed
  - Why
  - Impact
  - How tested
- หลีกเลี่ยงแยก changelog ไปหลายไฟล์เพื่อกันข้อมูลไม่ตรงกัน

---

> ไฟล์ `PROJECT_REVIEW.md` และ `docs/SYSTEM_UPDATES.md` ถูกย่อให้เป็นไฟล์ชี้มายัง `PROJECT_HQ.md` เท่านั้น
