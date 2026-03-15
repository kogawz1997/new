# Customer Onboarding

คู่มือนี้ใช้สำหรับติดตั้งและเปิดระบบ production ตาม topology ที่โปรเจกต์รองรับจริง

อัปเดตล่าสุด: **2026-03-15**

โดเมนตัวอย่างที่ใช้ใน deployment ปัจจุบัน:

- player portal: `https://player.genz.noah-dns.online`
- admin portal: `https://admin.genz.noah-dns.online/admin`

## 1. ชุดระบบที่ลูกค้าได้รับ

- Discord bot สำหรับ economy, shop, reward, moderation, community ops
- worker สำหรับ delivery queue และ rent bike runtime
- watcher สำหรับ ingest event จาก `SCUM.log`
- admin web สำหรับ config, delivery operations, observability, backup/restore, audit
- player portal สำหรับ wallet, purchase history, redeem, profile, steam link
- console-agent สำหรับ agent mode

## 2. Runtime topology

- `bot`
  - Discord gateway
  - slash/button/modal interactions
  - admin web
  - SCUM webhook receiver
- `worker`
  - delivery queue
  - rent bike runtime
- `watcher`
  - tail `SCUM.log`
  - ส่ง event เข้า `/scum-event`
- `web`
  - player portal standalone
- `console-agent`
  - bridge คำสั่งไปยัง SCUM admin client

## 3. สิ่งที่ต้องเตรียม

1. Node.js 20+
2. npm
3. PostgreSQL สำหรับ production
4. Discord application / bot พร้อม token จริง
5. ถ้าใช้ `agent mode`
   - Windows session ที่ไม่ถูก lock
   - SCUM client ที่ล็อกอินแอดมินและเปิดค้างไว้
6. ถ้าจะใช้ PM2:

```bat
npm i -g pm2
```

## 4. เตรียม env

1. root env

```bat
copy .env.production.example .env
```

2. player portal env

```bat
copy apps\web-portal-standalone\.env.production.example apps\web-portal-standalone\.env
```

## 5. ค่าหลักที่ต้องยืนยัน

ใน [`.env`](../.env)

- `NODE_ENV=production`
- `DATABASE_PROVIDER=postgresql`
- `DATABASE_URL=<postgresql://...>`
- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`
- `DISCORD_TOKEN=<token จริง>`
- `SCUM_WEBHOOK_SECRET=<secret จริง>`
- `ADMIN_WEB_PASSWORD=<password จริง>`
- `ADMIN_WEB_TOKEN=<token จริง>`
- `ADMIN_WEB_2FA_ENABLED=true`
- `ADMIN_WEB_STEP_UP_ENABLED=true`

runtime split ฝั่ง production

- bot
  - `BOT_ENABLE_ADMIN_WEB=true`
  - `BOT_ENABLE_RENTBIKE_SERVICE=false`
  - `BOT_ENABLE_DELIVERY_WORKER=false`
- worker
  - `WORKER_ENABLE_RENTBIKE=true`
  - `WORKER_ENABLE_DELIVERY=true`
- watcher
  - `SCUM_WATCHER_HEALTH_PORT=3212`
- web
  - `WEB_PORTAL_PORT=3300`

## 6. Discord OAuth

Discord Developer Portal -> OAuth2 -> Redirects

อย่างน้อยต้องมี:

- player portal: `https://player.genz.noah-dns.online/auth/discord/callback`
- admin SSO: `https://admin.genz.noah-dns.online/admin/auth/discord/callback`

ค่าที่ต้องมีใน env:

- `WEB_PORTAL_DISCORD_CLIENT_ID`
- `WEB_PORTAL_DISCORD_CLIENT_SECRET`
- `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET`

## 7. Database setup

### ทางเลือก A: ใช้ PostgreSQL ของลูกค้า

```bat
npm install
npm run db:generate:postgresql
npm run db:migrate:deploy:postgresql
```

### ทางเลือก B: ใช้ local PostgreSQL helper บนเครื่องนี้

```bat
npm run postgres:local:setup
npm run db:generate:postgresql
npm run db:migrate:deploy:postgresql
```

### ถ้ามีข้อมูล SQLite เดิมและต้องการ cut over

```bat
npm run db:cutover:postgresql -- --source-sqlite prisma/prisma/production.db
```

## 8. วิธี start

### รันเองทีละตัว

เปิดหลาย terminal:

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
pm2 status
```

ถ้าแก้ `.env` แล้วต้อง reload:

```bat
npm run pm2:reload:prod
```

## 9. ตรวจระบบหลังเปิดใช้งาน

### Health endpoints

- bot: `http://127.0.0.1:3210/healthz`
- worker: `http://127.0.0.1:3211/healthz`
- watcher: `http://127.0.0.1:3212/healthz`
- admin web: `http://127.0.0.1:3200/healthz`
- player portal: `http://127.0.0.1:3300/healthz`
- console-agent: `http://127.0.0.1:3213/healthz`

### Validation

```bat
npm run doctor
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

## 10. สิ่งที่ควร demo ให้ลูกค้าเห็น

- dashboard landing ที่สรุป topology, delivery runtime, และ restore guardrails
- delivery preflight / simulator / capability tester
- delivery detail พร้อม timeline และ step log
- observability recent requests และ security events
- backup / restore workflow
- player portal ฝั่ง wallet / purchase / redeem / steam link

## 11. ข้อจำกัดที่ต้องแจ้งลูกค้า

- agent mode ยังขึ้นกับ Windows session และ SCUM admin client จริง
- admin web ยังไม่ครอบทุก setting ใน env/config
- tenant isolation ยังไม่ใช่ database-per-tenant
- game-side delivery verification ยังไม่ใช่ inventory-native proof ทุกกรณี

## 12. เอกสารอ้างอิง

- [README.md](../README.md)
- [PROJECT_HQ.md](../PROJECT_HQ.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [OPERATIONS_MANUAL_TH.md](./OPERATIONS_MANUAL_TH.md)
- [GO_LIVE_CHECKLIST_TH.md](./GO_LIVE_CHECKLIST_TH.md)
- [LIMITATIONS_AND_SLA_TH.md](./LIMITATIONS_AND_SLA_TH.md)
