# Deployment Story (Production)

runbook นี้ใช้สำหรับติดตั้งระบบจริงแบบ end-to-end โดยยึด topology แยก process ชัดเจน

- player portal: `https://player.genz.noah-dns.online`
- admin portal: `https://admin.genz.noah-dns.online/admin`

## 1) Topology ที่แนะนำ

- `bot`
  - Discord gateway
  - slash/button/modal interactions
  - admin web
  - SCUM webhook receiver
  - restart scheduler
- `worker`
  - delivery queue
  - rent bike runtime
- `watcher`
  - tail `SCUM.log`
  - forward event เข้า webhook
- `web-portal`
  - player portal

## 2) Baseline env ที่ต้องมี

- `NODE_ENV=production`
- `DATABASE_URL=file:/.../production.db`
- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`

secrets ที่ต้องหมุน:

- `DISCORD_TOKEN`
- `SCUM_WEBHOOK_SECRET`
- `ADMIN_WEB_PASSWORD`
- `ADMIN_WEB_TOKEN`
- `RCON_PASSWORD`
- `WEB_PORTAL_DISCORD_CLIENT_SECRET`

ไฟล์ตั้งต้นที่ควรใช้:

```bat
copy .env.production.example .env
copy apps\web-portal-standalone\.env.production.example apps\web-portal-standalone\.env
```

## 3) Deploy ด้วย PM2

ติดตั้งและ migrate:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
```

ตรวจ topology:

```bash
npm run doctor:topology:prod
```

start stack:

```bash
npm run pm2:start:prod
pm2 status
```

reload หลังแก้ `.env`:

```bash
npm run pm2:reload:prod
```

Windows helper:

```bat
deploy\start-production-stack.cmd
deploy\reload-production-stack.cmd
deploy\stop-production-stack.cmd
```

Windows one-click:

```bat
npm run deploy:oneclick:win
```

## 4) Deploy ด้วย Docker Compose

ไฟล์ที่ใช้:

- `Dockerfile`
- `deploy/docker-compose.production.yml`

คำสั่ง:

```bash
docker compose -f deploy/docker-compose.production.yml up -d --build
docker compose -f deploy/docker-compose.production.yml ps
```

หยุด:

```bash
docker compose -f deploy/docker-compose.production.yml down
```

## 5) Deploy ด้วย systemd (Linux)

```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now scum-bot scum-worker scum-watcher scum-web-portal
sudo systemctl status scum-bot
```

ดู log:

```bash
journalctl -u scum-bot -f
journalctl -u scum-worker -f
```

## 6) Reverse Proxy Example

ดูตัวอย่าง:

- `deploy/nginx.player-admin.example.conf`

แนวทาง:

- `https://admin.genz.noah-dns.online/admin` -> `127.0.0.1:3200`
- `https://player.genz.noah-dns.online` -> `127.0.0.1:3300`
- บังคับ HTTPS

OAuth redirects ที่ต้องลงใน Discord:

- player portal: `https://player.genz.noah-dns.online/auth/discord/callback`
- admin SSO: `https://admin.genz.noah-dns.online/admin/auth/discord/callback`

## 7) Health Matrix

- bot: `127.0.0.1:3210/healthz`
- worker: `127.0.0.1:3211/healthz`
- watcher: `127.0.0.1:3212/healthz`
- admin: `127.0.0.1:3200/healthz`
- player: `127.0.0.1:3300/healthz`

ควรผูก uptime monitor ทุก endpoint

## 8) Text Repair / Data Hygiene

สแกนข้อความเพี้ยนใน DB:

```bash
npm run text:scan
```

ซ่อมจริง:

```bash
npm run text:repair
```

หมายเหตุ:

- script จะ backup SQLite DB ไปที่ `backups/` ก่อน
- ใช้ซ่อมข้อความ mojibake เก่าที่ค้างใน runtime/config/store

## 9) Backup / Restore

### Backup

1. login ด้วย owner/admin
2. export backup จากหน้า admin
3. เก็บไฟล์ backup ลง external storage

### Restore Drill

1. restore ใน staging ก่อน
2. run validation
3. restore จริง
4. ตรวจ integrity ของ wallet / purchase / queue / dead-letter

### Incident Restore

1. เปิด maintenance
2. restore snapshot ล่าสุด
3. รัน `npm run smoke:postdeploy`
4. เฝ้า metrics หลังเปิดระบบ

## 10) Rollback

1. rollback process ไป release ก่อนหน้า
2. restore DB จาก backup ก่อน deploy
3. ยืนยัน `healthz` และ smoke test ผ่าน
4. เปิด traffic กลับตามลำดับ

## 11) Gate ก่อนเปิดใช้งานจริง

```bash
npm run security:check
npm run doctor:topology:prod
npm run readiness:prod
npm run smoke:postdeploy
```

ต้องผ่านทั้งหมดก่อนเปิดรับผู้เล่นจริง
