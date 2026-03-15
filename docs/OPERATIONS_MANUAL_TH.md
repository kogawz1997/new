# คู่มือใช้งานและตั้งค่าระบบ SCUM TH Platform

เอกสารนี้เป็นคู่มือปฏิบัติการหลักของระบบ ใช้สำหรับติดตั้ง, ตั้งค่า, รัน, ทดสอบ, ตรวจสุขภาพ, และดูแลระบบในงานจริง

อัปเดตล่าสุด: **2026-03-15**

เอกสารที่เกี่ยวข้อง

- ภาพรวมระบบ: [README.md](../README.md)
- อธิบายตัวแปร `.env`: [ENV_REFERENCE_TH.md](./ENV_REFERENCE_TH.md)
- รายงาน gap ระหว่าง `.env` จริงกับ production baseline: [PRODUCTION_ENV_GAP_TH.md](./PRODUCTION_ENV_GAP_TH.md)
- สถานะและ roadmap: [PROJECT_HQ.md](../PROJECT_HQ.md)
- deployment เพิ่มเติม: [DEPLOYMENT_STORY.md](./DEPLOYMENT_STORY.md)
- สถาปัตยกรรม: [ARCHITECTURE.md](./ARCHITECTURE.md)
- policy การ migration / rollback / restore: [MIGRATION_ROLLBACK_POLICY_TH.md](./MIGRATION_ROLLBACK_POLICY_TH.md)

## 1. โครงสร้าง runtime

1. `bot`
- Discord slash commands
- panel / button / modal
- admin web
- SCUM webhook receiver

2. `worker`
- delivery queue
- retry / dead-letter / watchdog
- rent bike queue

3. `watcher`
- อ่าน `SCUM.log`
- parse event และยิงเข้า webhook

4. `admin web`
- dashboard แอดมิน
- config, audit, snapshot, observability, delivery tools
- tenant config, security events, step-up auth

5. `player portal`
- เว็บผู้เล่น login ผ่าน Discord
- dashboard / profile / wallet / shop / orders

6. `console-agent`
- bridge คำสั่งจาก worker ไปยัง SCUM admin client
- ใช้กับ `agent mode`

## 2. โหมดส่งของ

### 2.1 RCON mode

ใช้เมื่อเซิร์ฟเวอร์รองรับการ execute คำสั่งผ่าน remote command จริง

ค่าหลัก:

- `DELIVERY_EXECUTION_MODE=rcon`
- `RCON_HOST`
- `RCON_PORT`
- `RCON_PASSWORD`
- `RCON_PROTOCOL=source|battleye`

### 2.2 Agent mode

ใช้เมื่อเซิร์ฟเวอร์ login ได้ แต่ command delivery ต้องวิ่งผ่าน SCUM client จริง

flow:

```text
Purchase
-> Delivery Queue
-> Worker
-> Console Agent
-> PowerShell Bridge
-> SCUM Admin Client
-> Admin Channel Command
```

สิ่งที่มีแล้ว:

- preflight ก่อน enqueue
- timeline / step log / audit / evidence
- circuit breaker และ failover policy

## 3. Database

runtime ปัจจุบันบนเครื่องนี้ใช้ PostgreSQL

ค่าหลัก:

```env
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://user:password@127.0.0.1:55432/scum_th_platform?schema=public
PERSIST_REQUIRE_DB=true
PERSIST_LEGACY_SNAPSHOTS=false
```

helper ที่มี:

```bat
npm run postgres:local:setup
npm run db:generate:postgresql
npm run db:migrate:deploy:postgresql
```

ถ้าต้องการ cut over จาก SQLite:

```bat
npm run db:cutover:postgresql -- --source-sqlite prisma/prisma/production.db
```

หมายเหตุ:

- SQLite ยังมีไว้สำหรับ dev/import/compatibility path
- test runner จะสร้าง isolated schema/database แยกจาก runtime จริง

## 4. ติดตั้งครั้งแรก

### 4.1 แบบเร็ว

```bat
npm run setup:easy
```

### 4.2 แบบ manual

```bat
npm install
copy .env.example .env
npm run db:generate:postgresql
npm run db:migrate:deploy:postgresql
npm run doctor
```

## 5. Runtime split

ค่าหลักใน `.env`:

```env
BOT_ENABLE_SCUM_WEBHOOK=true
BOT_ENABLE_RESTART_SCHEDULER=true
BOT_ENABLE_ADMIN_WEB=true
BOT_ENABLE_RENTBIKE_SERVICE=false
BOT_ENABLE_DELIVERY_WORKER=false

WORKER_ENABLE_RENTBIKE=true
WORKER_ENABLE_DELIVERY=true
```

กติกา:

- ถ้าใช้ `worker` แยก process แล้ว อย่าเปิด `BOT_ENABLE_DELIVERY_WORKER=true`
- อย่าเปิด delivery worker ซ้ำทั้ง bot และ worker พร้อมกัน

## 6. Admin Web

ค่าหลัก:

```env
ADMIN_WEB_HOST=127.0.0.1
ADMIN_WEB_PORT=3200
ADMIN_WEB_ALLOWED_ORIGINS=https://admin.genz.noah-dns.online
ADMIN_WEB_SECURE_COOKIE=true
ADMIN_WEB_TRUST_PROXY=true
ADMIN_WEB_2FA_ENABLED=true
ADMIN_WEB_STEP_UP_ENABLED=true
ADMIN_WEB_SSO_DISCORD_ENABLED=true
```

สิ่งที่มีใน admin web:

- DB login
- Discord SSO
- 2FA
- step-up auth
- security events
- session revoke
- backup / restore preview
- delivery tools
- tenant config scope บางส่วน

## 7. Health / readiness / smoke

health endpoints:

- bot: `http://127.0.0.1:3210/healthz`
- worker: `http://127.0.0.1:3211/healthz`
- watcher: `http://127.0.0.1:3212/healthz`
- console-agent: `http://127.0.0.1:3213/healthz`
- admin web: `http://127.0.0.1:3200/healthz`
- player portal: `http://127.0.0.1:3300/healthz`

คำสั่งตรวจหลัก:

```bat
npm run doctor
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

## 8. การรันระบบ

### รันเองทีละตัว

```bat
npm run start:bot
npm run start:worker
npm run start:watcher
npm run start:scum-agent
npm run start:web-standalone
```

### ใช้ PM2

```bat
npm run pm2:start:prod
npm run pm2:reload:prod
```

## 9. ข้อจำกัดปัจจุบัน

- current `.env` บนเครื่องนี้ใช้ `DELIVERY_EXECUTION_MODE=rcon`
- `agent mode` ยังพึ่ง Windows session และ SCUM admin client จริง
- tenant isolation ยังไม่ใช่ database-per-tenant
- admin web ยังไม่ครอบทุก setting ในระบบ

## 10. หลักฐานที่ควรใช้เวลาอ้างอิง

- `artifacts/ci/verification-summary.json`
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/*.log`
- integration tests ใน `test/`
