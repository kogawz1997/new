# Customer Onboarding

คู่มือนี้ใช้สำหรับติดตั้งและเปิดระบบ production ตาม topology ที่โปรเจกต์รองรับจริง:
`bot / worker / watcher / web`

โดเมนตัวอย่างในคู่มือนี้ถูกตั้งให้ตรงกับ deployment ปัจจุบัน:

- player portal: `https://player.genz.noah-dns.online`
- admin portal: `https://admin.genz.noah-dns.online/admin`

## 0) ลูกค้าได้รับอะไรจากชุดนี้

ชุดส่งมอบมาตรฐานของโปรเจกต์นี้ไม่ใช่แค่บอท แต่เป็นระบบครบชุด:

- Discord bot สำหรับ economy, shop, reward และ community ops
- worker สำหรับ delivery queue และ rent bike runtime
- watcher สำหรับ ingest event จาก `SCUM.log`
- admin web สำหรับ config, delivery operations, backup/restore, audit และ observability
- player portal สำหรับ wallet, purchase history, redeem, profile และ steam link

ถ้าต้องใช้เอกสารสำหรับพรีเซนต์ภาพรวมระบบ ให้เปิด [docs/SHOWCASE_TH.md](./SHOWCASE_TH.md) ควบคู่กัน
ก่อน go-live ให้ไล่ตาม [docs/GO_LIVE_CHECKLIST_TH.md](./GO_LIVE_CHECKLIST_TH.md)

## 1) หน้าที่ของแต่ละ runtime

- `bot`
  - Discord gateway
  - slash/button/modal interactions
  - admin web
  - SCUM webhook receiver
  - restart scheduler
  - ops alert route
- `worker`
  - delivery queue
  - rent bike runtime
- `watcher`
  - tail `SCUM.log`
  - ส่ง event เข้า `/scum-event`
- `web`
  - player portal standalone

## 2) สิ่งที่ต้องเตรียม

1. Node.js 20+
2. npm
3. Prisma ใช้งานได้
4. Discord Application / Bot พร้อม token จริง
5. ถ้าใช้ PM2:

```bat
npm i -g pm2
```

## 3) เตรียมไฟล์ env

1. root env

```bat
copy .env.production.example .env
```

2. player portal env

```bat
copy apps\web-portal-standalone\.env.production.example apps\web-portal-standalone\.env
```

## 4) ค่า production baseline ที่ต้องยืนยัน

ใน [\.env](c:/new/.env)

- `NODE_ENV=production`
- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`
- `DISCORD_TOKEN=<token จริง>`
- `SCUM_WEBHOOK_SECRET=<secret จริง>`
- `ADMIN_WEB_PASSWORD=<password จริง>`
- `ADMIN_WEB_TOKEN=<token จริง>`
- `DATABASE_URL=<db จริง>`

runtime split ฝั่ง production

- bot
  - `BOT_ENABLE_ADMIN_WEB=true`
  - `BOT_ENABLE_RENTBIKE_SERVICE=false`
  - `BOT_ENABLE_DELIVERY_WORKER=false`
  - `BOT_HEALTH_PORT=3210`
- worker
  - `WORKER_ENABLE_RENTBIKE=true`
  - `WORKER_ENABLE_DELIVERY=true`
  - `WORKER_HEALTH_PORT=3211`
- watcher
  - `SCUM_WATCHER_HEALTH_PORT=3212`
- web
  - `WEB_PORTAL_PORT=3300`

## 5) ตั้งค่า Discord OAuth ให้ตรงโดเมนจริง

Discord Developer Portal -> OAuth2 -> Redirects

ต้องมีอย่างน้อย:

- player portal: `https://player.genz.noah-dns.online/auth/discord/callback`
- admin SSO: `https://admin.genz.noah-dns.online/admin/auth/discord/callback`

ค่าที่ต้องมีใน env:

- `WEB_PORTAL_DISCORD_CLIENT_ID`
- `WEB_PORTAL_DISCORD_CLIENT_SECRET`

ถ้าจะ reuse secret ผ่าน root env:

- ตั้ง `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET=<secret จริง>`
- ปล่อย `WEB_PORTAL_DISCORD_CLIENT_SECRET=` ว่างได้

## 6) หมุน secret ก่อน deploy

```bat
npm run security:rotate:prod -- --discord-token <DISCORD_TOKEN จริง> --portal-discord-secret <WEB_PORTAL_DISCORD_CLIENT_SECRET จริง>
```

สคริปต์นี้จะตั้งค่า:

- `NODE_ENV=production`
- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`
- `WEB_PORTAL_BASE_URL=https://player.genz.noah-dns.online`
- `WEB_PORTAL_LEGACY_ADMIN_URL=https://admin.genz.noah-dns.online/admin`
- `WEB_PORTAL_DISCORD_REDIRECT_PATH=/auth/discord/callback`

## 7) ติดตั้ง dependency และ migrate

```bat
npm install
npx prisma generate
npx prisma migrate deploy
```

## 8) วิธี start แบบแยก process

### รันเองทีละตัว

เปิด 4 terminal:

```bat
npm run start:bot
```

```bat
npm run start:worker
```

```bat
npm run start:watcher
```

```bat
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

หรือใช้ helper Windows:

```bat
deploy\start-production-stack.cmd
deploy\reload-production-stack.cmd
deploy\stop-production-stack.cmd
```

manifest ที่ใช้งาน:

- `deploy/pm2.ecosystem.config.cjs`

## 9) ตรวจระบบหลังเปิดใช้งาน

### Health endpoints

- bot: `http://127.0.0.1:3210/healthz`
- worker: `http://127.0.0.1:3211/healthz`
- watcher: `http://127.0.0.1:3212/healthz`
- admin web: `http://127.0.0.1:3200/healthz`
- player portal: `http://127.0.0.1:3300/healthz`

### Readiness + smoke

```bat
npm run readiness:prod
npm run smoke:postdeploy
```

ถ้าต้องการรวม audit:

```bat
npm run readiness:prod:audit
```

ตั้งค่า base URL ให้ smoke script:

```bat
set SMOKE_ADMIN_BASE_URL=https://admin.genz.noah-dns.online/admin
set SMOKE_PLAYER_BASE_URL=https://player.genz.noah-dns.online
npm run smoke:postdeploy
```

### Topology + text repair

```bat
npm run doctor:topology:prod
npm run text:repair
```

## 10) งานที่ลูกค้าทำผ่าน panel เป็นหลัก

- จัดการ config
- ดู queue / dead-letter
- backup / restore
- ดู metrics / alerts
- จัดการร้านค้า / เศรษฐกิจ / กิจกรรม

## 10.1) สิ่งที่ควร demo ให้ลูกค้าเห็นก่อนส่งมอบ

- dashboard landing ที่สรุป topology, delivery runtime และ restore guardrails
- delivery preflight / simulator / capability tester
- delivery detail รายออเดอร์พร้อม timeline และ step log
- notification center และ backup/restore workflow
- player portal ฝั่ง wallet / purchase / redeem / steam link

## 11) กติกาความปลอดภัยที่ต้องย้ำ

1. ห้าม commit `.env`
2. ถ้าสงสัยว่า token หลุด ให้หมุนใหม่ทันที
3. admin และ player portal ต้องอยู่หลัง HTTPS reverse proxy
4. ห้ามเปิด production โดยยังตั้ง `PERSIST_LEGACY_SNAPSHOTS=true`
5. ต้องรัน `npm run readiness:prod` และ `npm run smoke:postdeploy` ทุกครั้งหลัง deploy
6. backup DB และไฟล์สำคัญออกนอกเครื่อง production เสมอ

## 12) เอกสารอ้างอิง

- [README.md](c:/new/README.md)
- [DEPLOYMENT_STORY.md](c:/new/docs/DEPLOYMENT_STORY.md)
- [ARCHITECTURE.md](c:/new/docs/ARCHITECTURE.md)
- [INCIDENT_RESPONSE.md](c:/new/docs/INCIDENT_RESPONSE.md)
