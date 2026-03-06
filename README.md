## SCUM Discord Bot – คู่มือติดตั้งและตั้งค่า

### 1) เตรียมเครื่อง

- ติดตั้ง **Node.js 20+** จากเว็บไซต์ทางการ
- บน Windows ให้เปิด **PowerShell** หรือ **Command Prompt** ที่โฟลเดอร์โปรเจกต์นี้

### 2) ติดตั้ง dependencies

ภายในโฟลเดอร์โปรเจกต์ (ที่มี `package.json`) รัน:

```bash
npm install
```

ถ้าเคยรันแล้วและมี `node_modules` อยู่แล้ว สามารถข้ามขั้นตอนนี้ได้

### 3) ตั้งค่า Discord Application / Bot

1. เข้า `https://discord.com/developers/applications`
2. กดปุ่ม **New Application** → ตั้งชื่อ (เช่น `SCUM TH Bot`)
3. ไปที่เมนู **Bot** → กด **Add Bot**
4. คัดลอก **Bot Token** (ใช้ค่าใน `.env` ด้านล่าง)
5. ในหน้า Bot:
   - เปิด **Privileged Gateway Intents**:
     - `SERVER MEMBERS INTENT`
     - `MESSAGE CONTENT INTENT`
6. ไปที่เมนู **OAuth2 → URL Generator**:
   - Scopes: เลือก `bot` และ `applications.commands`
   - Bot Permissions (อย่างน้อย):
     - `Manage Roles`
     - `View Channels`
     - `Send Messages`
     - `Manage Messages`
     - `Read Message History`
     - `Mute Members`
     - `Timeout Members`
   - นำ URL ที่ได้ไปเปิดในเบราว์เซอร์เพื่อเชิญบอทเข้าเซิร์ฟของคุณ

### 4) ตั้งค่าไฟล์ .env

สร้างไฟล์ `.env` ในโฟลเดอร์โปรเจกต์ (ก๊อปจาก `.env.example` ได้) แล้วกรอกค่า:

```env
DISCORD_TOKEN=ใส่_bot_token_ที่ได้จากหน้า Bot
DISCORD_CLIENT_ID=Application_ID (จากหน้า General Information)
DISCORD_GUILD_ID=ID เซิร์ฟ Discord ของคุณ

SCUM_WEBHOOK_PORT=3100
SCUM_WEBHOOK_SECRET=ใส่รหัสลับสักตัว

# Windows path ต้อง escape backslash เช่น D:\\SCUMServer\\SCUM.log
SCUM_LOG_PATH=D:\\SCUMServer\\SCUM.log
# ปกติไม่ต้องแก้ ถ้ารัน watcher เครื่องเดียวกับบอท
SCUM_WEBHOOK_URL=http://127.0.0.1:3100/scum-event

# โฟลเดอร์เก็บข้อมูลถาวร (ถ้าไม่ใส่ จะใช้ ./data)
#BOT_DATA_DIR=Z:\\scum-bot-data
```

วิธีดู Guild ID:

- เปิด Discord → Settings → Advanced → เปิด **Developer Mode**
- คลิกขวาที่ไอคอนเซิร์ฟ → Copy Server ID

### 5) สร้างโครงช่องและ role ในเซิร์ฟ

#### แนะนำ Channel หลัก

- หมวด SERVER
  - `#server-info`
  - `#announcements`
  - `#status-online`
  - `#restart-alerts`
  - `#player-join`
- หมวด COMMUNITY
  - `#general`, `#find-squad`, `#clips`, `#suggestions`
- หมวด PVP
  - `#kill-feed`, `#bounty-board`, `#leaderboards`
- หมวด SHOP
  - `#shop`, `#shop-log`, `#redeem`, `#vip`
- หมวด SUPPORT
  - `#rules-report`, `#tickets`, `#appeal-ban`
- หมวด STAFF (ซ่อน)
  - `#admin-log`, `#evidence`, `#staff-chat`

> ชื่อบางห้องผูกอยู่ใน `src/config.js` (เช่น `status-online`, `shop-log`, `evidence`, `admin-log`, `tickets`) ถ้าคุณใช้ชื่ออื่นให้แก้ค่าในไฟล์นี้ให้ตรงกัน

#### แนะนำ Roles

สร้าง role เหล่านี้ให้ตรงกับ `src/config.js`:

- `Owner`
- `Admin`
- `Moderator`
- `Helper`
- `VIP`
- `Verified`
- `Muted`

> ถ้าอยากใช้ชื่อ Role อื่น ให้ไปแก้ใน `roles` ภายใน `src/config.js` ให้ตรงกับชื่อจริงในเซิร์ฟ

### 6) ลงทะเบียน Slash Commands

ทุกคำสั่ง `/` อยู่ในโฟลเดอร์ `src/commands` และมีสคริปต์สำหรับ register:

```bash
npm run register-commands
```

รันคำสั่งนี้ทุกครั้งที่คุณเพิ่ม/ลบ/แก้ไขไฟล์คำสั่งใน `src/commands`.

### 7) รันบอท

```bash
npm start
```

ถ้า token ถูกต้องและบอทมีสิทธิ์ จะเห็นข้อความในเทอร์มินัลประมาณ:

```text
Bot logged in as ชื่อบอทของคุณ
```

จากนั้นไปที่ Discord เซิร์ฟของคุณแล้วลองคำสั่ง:

- `/ping` – ทดสอบว่าบอทตอบหรือไม่
- `/balance`, `/daily`, `/weekly` – ทดสอบระบบเงิน
- `/shop`, `/buy`, `/inventory` – ทดสอบร้านค้า
- `/ticket open` – ทดสอบระบบ ticket
- `/board type:economy` – ดูบอร์ดจัดอันดับเหรียญแบบลูกเล่น
- `/panel welcome-pack` – โพสต์ปุ่มต้อนรับ/ลิงก์คำสั่งแบบ interactive
- `/panel verify image_url:<url>` – โพสต์การ์ด Verify Steam ID พร้อมปุ่มกรอก SteamID
- `/panel top-killer` และ `/panel top-gun-kill` – โพสต์ตารางอันดับสไตล์บอร์ด
- `/panel shop-card item_id:<id>` – โพสต์การ์ดสินค้าแบบมีปุ่ม Buy/Add cart/Checkout
- `/panel ticket-admin` – โพสต์ปุ่มเปิด Ticket แบบในภาพตัวอย่าง
- `/panel shop-feed keyword:<หมวด>` – โพสต์สินค้าทั้งชุดในหมวดเดียวกัน (พร้อมปุ่ม Buy/Add cart/Checkout)

### 8) เชื่อม SCUM (เครื่องเดียวกับที่รันบอท Windows)

แนวคิดคือ:

- ตัวบอทเปิด HTTP webhook ไว้ที่ `http://127.0.0.1:<SCUM_WEBHOOK_PORT>/scum-event`
- สคริปต์ `scum-log-watcher.js` จะ “อ่าน SCUM.log” แล้วส่ง event เข้า webhook

#### 8.1 ตั้งค่า path ของ SCUM.log

แก้ค่าใน `.env`:

- `SCUM_LOG_PATH` ให้ชี้ไปยังไฟล์ `SCUM.log` จริง
  - ตัวอย่าง: `D:\\SCUMServer\\SCUM.log`

> หมายเหตุ: ถ้าเซิร์ฟคุณเขียน log ชื่อ/ตำแหน่งต่างกัน ให้ชี้ให้ถูกก่อน

#### 8.2 รันตัวอ่าน log (watcher)

เปิด PowerShell อีกหน้าต่าง (หรือรันแยก service) แล้วรัน:

```bash
npm run watch-scum
```

ถ้าทุกอย่างถูกต้อง จะเห็นใน console ว่า “พบ event” เมื่อมีคนเข้า/ออก/ฆ่ากัน/เซิร์ฟปิด และ Discord จะมีข้อความเข้า:

- `#player-join` (เข้า/ออก)
- `#kill-feed` (kill feed)
- `#restart-alerts` (สัญญาณปิด log / restart)

#### 8.3 ทดสอบ webhook แบบเร็ว (ไม่ต้องรอ log)

เปิด PowerShell แล้วลองยิง event เข้า webhook:

```bash
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3100/scum-event" -ContentType "application/json" -Body '{"secret":"ใส่ให้ตรงกับ .env","guildId":"DISCORD_GUILD_ID","type":"join","playerName":"TestPlayer"}'
```

ถ้าบอททำงาน จะมีข้อความ join เด้งเข้า `#player-join` (ถ้าคุณเปลี่ยน `SCUM_WEBHOOK_PORT` ให้แก้ URL ให้ตรง)

### 9) ลิงก์ SteamID ↔ Discord (ทำให้ค่าหัว/สถิติโอนอัตโนมัติ)

เพื่อให้บอทรู้ว่า “คนใน log (SteamID/ชื่อในเกม)” คือ “Discord user คนไหน” ให้ผู้เล่นลิงก์ SteamID64 ของตัวเอง:

- `/linksteam set steamid:<SteamID64> name:<ชื่อในเกม (ถ้ามี)>`
- `/linksteam me` ดูลิงก์ของตัวเอง
- `/linksteam unset` ยกเลิกลิงก์

staff:

- `/linksteam lookup steamid:<SteamID64>` เช็คว่า SteamID นี้เป็นของใคร
- `/linksteam setuser user:<@user> steamid:<SteamID64>` ลิงก์ให้คนอื่น (กรณีช่วยยืนยัน)

> เมื่อมี kill event เข้ามาพร้อม `killerSteamId/victimSteamId` บอทจะอัปเดต `/stats` และถ้ามี bounty จะโอนเหรียญให้คนฆ่าอัตโนมัติ (เฉพาะเคสที่ลิงก์แล้ว)

### 10) โครงระบบสำคัญที่มีให้แล้ว

- ระบบเงิน + ร้าน (Coins + Shop + log แอดมิน)
- ระบบเชื่อมเซิร์ฟ SCUM ระดับพื้นฐานผ่าน webhook + log watcher (join/leave/kill/restart)
- ระบบ Tickets (เปิด/claim/close/transcript)
- ระบบ Report, Auto-moderation (spam + คำหยาบเบื้องต้น) และคำสั่ง `mute/unmute/warn/punishlog`
- ระบบ Event (`/event create/join/start/end`)
- ระบบ Bounty (`/bounty add/list/cancel`)
- ระบบ Stats + Leaderboard (`/stats`, `/top`)
- ระบบ VIP (`/vip list/buy/perks/status`) ผูกกับ role VIP และหักเหรียญ

> ตอนนี้ข้อมูลหลักถูกบันทึกลงไฟล์ JSON ในโฟลเดอร์ `data/` แล้ว (persistent) รีสตาร์ทบอทข้อมูลไม่หาย  
> ถ้าจะใช้ระยะยาวมาก ๆ ยังแนะนำต่อยอดเป็นฐานข้อมูลจริง (เช่น Prisma + SQLite/PostgreSQL) เพื่อรองรับ concurrent/backup/query ได้ดีขึ้น

# discord

## Admin Web Dashboard

The bot now starts a built-in web admin panel for centralized management.

- URL: `http://127.0.0.1:3200/admin` (default)
- Auth: login with username/password (session cookie)
- API still supports `x-admin-token` as fallback for scripts

Configure via `.env`:

```env
ADMIN_WEB_HOST=127.0.0.1
ADMIN_WEB_PORT=3200
ADMIN_WEB_USER=admin
ADMIN_WEB_PASSWORD=your_secure_password
ADMIN_WEB_SESSION_TTL_HOURS=12
ADMIN_WEB_SECURE_COOKIE=false
ADMIN_WEB_HSTS_ENABLED=false
ADMIN_WEB_HSTS_MAX_AGE_SEC=31536000
ADMIN_WEB_TOKEN=optional_api_token_fallback
ADMIN_WEB_MAX_BODY_BYTES=1048576
ADMIN_WEB_TRUST_PROXY=false
ADMIN_WEB_ALLOW_TOKEN_QUERY=false
ADMIN_WEB_ENFORCE_ORIGIN_CHECK=true
ADMIN_WEB_ALLOWED_ORIGINS=http://127.0.0.1:3200
```

Notes:

- If `ADMIN_WEB_PASSWORD` is empty, login password falls back to `ADMIN_WEB_TOKEN`.
- If both are empty, a one-time token/password is generated and printed at startup.
- For HTTPS production behind reverse proxy:
  - set `ADMIN_WEB_SECURE_COOKIE=true`
  - set `ADMIN_WEB_HSTS_ENABLED=true`
  - set `ADMIN_WEB_TRUST_PROXY=true` only when proxy is trusted
  - set `ADMIN_WEB_ALLOWED_ORIGINS` to your admin domain(s)
- Query token auth (`?token=`) is disabled by default. Use `x-admin-token` or `Authorization: Bearer ...`.

The dashboard includes one-place management for:

- Economy wallets
- Shop items and purchase statuses
- Tickets
- Events and bounties
- Steam links, VIP memberships, redeem codes
- Moderation entries
- Welcome pack claims
- SCUM status + full live data snapshot tables

## Update Log Policy

- ทุกครั้งที่อัปเดตระบบ ให้บันทึกรายละเอียดไว้ที่ [docs/SYSTEM_UPDATES.md](/c:/new/docs/SYSTEM_UPDATES.md)
- แต่ละรอบอัปเดตควรมี: เป้าหมาย, สิ่งที่เปลี่ยน, ผลกระทบ, วิธีทดสอบ
- ก่อนปล่อยระบบให้รัน `npm run lint` และ `npm test` ทุกครั้ง

## Auto Delivery (RCON Queue + Retry + Audit)

Purchases can now be delivered automatically through an RCON worker queue.

What is included:

- Queue with persistence (`data/delivery-queue.json` or DB-backed persist layer)
- Retry with backoff
- Audit log (`data/delivery-audit.json` or DB-backed persist layer)
- Purchase status flow: `delivering` -> `delivered` (or `delivery_failed`)
- Admin web controls: enqueue by code, retry now, cancel queue job

Required runtime setup:

```env
RCON_HOST=127.0.0.1
RCON_PORT=27015
RCON_PASSWORD=your_rcon_password
RCON_EXEC_TEMPLATE=mcrcon -H {host} -P {port} -p "{password}" "{command}"
```

Enable in config (`src/config.js` or Admin Config Editor):

```json
{
  "delivery": {
    "auto": {
      "enabled": true,
      "itemCommands": {
        "vip-7d": [
          "spawnitem {steamId} BP_Item_VIP_7D 1"
        ],
        "loot-box": "spawnitem {steamId} BP_Loot_Box 1"
      }
    }
  }
}
```

Command placeholders supported in each item command:

- `{steamId}`
- `{itemId}`
- `{itemName}`
- `{gameItemId}`
- `{quantity}`
- `{itemKind}`
- `{userId}`
- `{purchaseCode}`

Notes:

- If auto delivery is disabled or item command is missing, purchase remains manual.
- For bundle items (multiple `deliveryItems`), command template must include `{gameItemId}` or `{quantity}`.
- If bundle template is invalid, queue enqueue is rejected with `bundle-template-missing-placeholder`.
- Steam link is required for auto delivery (`/linksteam set ...`).
- Audit and queue are visible from admin snapshot datasets: `deliveryQueue`, `deliveryAudit`, `observability`.

### Observability / Alerts

Built-in runtime metrics and alerting are now available for production monitoring:

- Delivery queue length alerts
- Delivery fail-rate alerts (rolling window)
- Admin login failure spike alerts (global + per-IP)
- SCUM watcher webhook error-rate alerts

Admin API:

- `GET /admin/api/observability` (requires auth) for current metrics snapshot

Related `.env` knobs:

```env
# Admin login spike alerts
ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS=300000
ADMIN_WEB_LOGIN_SPIKE_THRESHOLD=10
ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD=5
ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS=60000

# Delivery queue / fail-rate alerts
DELIVERY_METRICS_WINDOW_MS=300000
DELIVERY_FAIL_RATE_ALERT_THRESHOLD=0.3
DELIVERY_FAIL_RATE_ALERT_MIN_SAMPLES=10
DELIVERY_QUEUE_ALERT_THRESHOLD=25
DELIVERY_ALERT_COOLDOWN_MS=60000

# SCUM watcher webhook / queue alerts
SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS=300000
SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS=10
SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD=0.3
SCUM_QUEUE_ALERT_THRESHOLD=1500
SCUM_ALERT_COOLDOWN_MS=60000
```

## Rent Motorbike (Daily)

Added slash command: `/rentbike`

Behavior:

- Daily limit: `1` rent per user per day
- Reset time: `00:00 Asia/Phnom_Penh`
- Vehicle type: motorbike only (config-driven spawn id)
- Queue: processes one order at a time to avoid vehicle id diff collisions
- Fail-safe: if vehicle instance id cannot be detected, order is marked `failed` and daily quota is not consumed

SCUM commands used by the flow:

- `#ListSpawnedVehicles`
- `#SpawnVehicle <ID>`
- `#DestroyVehicle <VehicleID>`

`#DestroyAllVehicles` is not used by default (to avoid deleting non-rental vehicles).

Storage tables (auto-created by backend):

- `daily_rent`
- `rental_vehicles`

Config keys:

```json
{
  "rentBike": {
    "timezone": "Asia/Phnom_Penh",
    "vehicle": {
      "spawnId": "YOUR_MOTORBIKE_SPAWN_ID"
    }
  }
}
```

Midnight cleanup:

- Service scans `rental_vehicles` with status `delivered|pending|delivering`
- Tries to destroy each tracked `vehicle_instance_id`
- Marks row as `destroyed` or `missing`
- Daily quota naturally resets by date key (no hard delete needed)
---

## อัปเดตคุณภาพโค้ด (เพิ่มใหม่)

โปรเจกต์มีการเพิ่ม baseline สำหรับการดูแลระยะยาวแล้ว:

- `npm run lint` ตรวจ syntax ของไฟล์ JavaScript ทั้งโปรเจกต์
- `npm test` รัน unit tests ด้วย `node:test`
- `npm run check` รัน lint + test ต่อเนื่อง
- `npm run doctor` ตรวจ dependency/runtime health (โหลดแพ็กเกจหลัก + ตรวจ DATABASE_URL)
- มี GitHub Actions workflow ที่ `.github/workflows/ci.yml` ให้รันอัตโนมัติบน push/PR
- มีเอกสาร architecture ที่ `docs/ARCHITECTURE.md`
- persistence หลักถูกย้ายไปเก็บใน SQLite (`DATABASE_URL`) ผ่าน `src/store/_persist.js` แล้ว (มี fallback migrate จากไฟล์ JSON เดิมอัตโนมัติ)

## Security Hardening Checklist (Production)

Use this baseline before exposing the bot/admin services to public networks:

- Set strong secrets:
  - `ADMIN_WEB_PASSWORD` (long random)
  - `ADMIN_WEB_TOKEN` (for script/API fallback)
  - `SCUM_WEBHOOK_SECRET` (long random)
- Prefer HTTPS + reverse proxy for admin panel:
  - `ADMIN_WEB_SECURE_COOKIE=true`
  - `ADMIN_WEB_HSTS_ENABLED=true`
  - `ADMIN_WEB_ALLOWED_ORIGINS=https://admin.your-domain.com`
  - `ADMIN_WEB_TRUST_PROXY=true` only when your proxy is trusted
- Keep query-token auth off by default:
  - `ADMIN_WEB_ALLOW_TOKEN_QUERY=false`
  - use `x-admin-token` or `Authorization: Bearer <token>` instead
- Keep origin enforcement enabled for session-based API calls:
  - `ADMIN_WEB_ENFORCE_ORIGIN_CHECK=true`
- Keep request limits enabled:
  - `ADMIN_WEB_MAX_BODY_BYTES=1048576`
  - `SCUM_WEBHOOK_MAX_BODY_BYTES=65536`
  - `SCUM_WEBHOOK_REQUEST_TIMEOUT_MS=10000`
- Network exposure:
  - keep `SCUM_WEBHOOK_PORT` bound to local/internal network when possible
  - do not expose admin port directly to internet without TLS/reverse proxy/WAF
- Operational hygiene:
  - rotate admin/webhook/RCON secrets periodically
  - run `npm run check` before deploy
  - keep dependencies updated and patch CVEs quickly

Note: no software can guarantee "unhackable". This checklist and current hardening significantly reduce common attack paths (CSRF, brute-force pressure, oversized payload abuse, weak auth usage).
