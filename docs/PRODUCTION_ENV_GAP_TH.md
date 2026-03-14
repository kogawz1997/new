# รายงานเทียบ `.env` จริงกับ production baseline

เอกสารนี้สรุปความต่างระหว่างไฟล์ตั้งค่าจริงในเครื่องปัจจุบันกับ template production baseline

อัปเดตล่าสุด: **2026-03-13**

ไฟล์ที่เทียบ
- root runtime: [../.env](../.env)
- root baseline: [../.env.production.example](../.env.production.example)
- portal runtime: [../apps/web-portal-standalone/.env](../apps/web-portal-standalone/.env)
- portal baseline: [../apps/web-portal-standalone/.env.production.example](../apps/web-portal-standalone/.env.production.example)

หมายเหตุ
- เอกสารนี้ **ไม่แสดงค่า secret จริง**
- จะบอกเฉพาะสถานะ:
  - `ตั้งแล้ว`
  - `ยังเป็น placeholder`
  - `ยังขาด`
  - `จงใจต่างจาก baseline`

---

## 1. สรุปภาพรวม

### สิ่งที่พร้อมแล้ว
- `NODE_ENV=production`
- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`
- split runtime หลักถูกแล้ว
  - bot ไม่รัน delivery worker ใน process เดียวกัน
  - worker รัน delivery แยก
- admin web ใช้
  - `secure cookie`
  - `trust proxy`
  - `origin check`
  - `HSTS`
- player portal ใช้
  - `https base url`
  - `secure cookie`
  - redirect path ใหม่ `/auth/discord/callback`
- delivery runtime ปัจจุบันตั้งเป็น `agent mode` และพิสูจน์ใช้งานจริงแล้ว

### จุดที่ยังไม่ปิด
- root `.env`
  - `DATABASE_URL` ยังชี้ `./prisma/dev.db`
  - `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET` ยังเป็น placeholder
- portal `.env`
  - `WEB_PORTAL_DISCORD_CLIENT_SECRET` ยังว่าง
  - กลุ่ม OAuth secret ยังไม่สมบูรณ์ แม้ค่าอื่นจะครบแล้ว

### blocker ปัจจุบันที่ทำให้ `security:check` / `readiness:prod` ยังไม่ผ่าน
1. `WEB_PORTAL_DISCORD_CLIENT_SECRET` ยังว่าง
2. fallback secret จาก root คือ `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET` ยังเป็น placeholder

สรุปตรง ๆ:
- ฝั่งโค้ด/โครงสร้างพร้อมแล้ว
- ฝั่ง env ยังต้องใส่ OAuth secret จริง 1 ชุดก่อน

---

## 2. Root `.env` เทียบ production baseline

### 2.1 Discord / Core

- `DISCORD_TOKEN`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: ควรหมุนใหม่ เพราะ token เคยถูกพิมพ์ในบทสนทนา/terminal
- `DISCORD_CLIENT_ID`
  - สถานะ: `ตั้งแล้ว`
- `DISCORD_GUILD_ID`
  - สถานะ: `ตั้งแล้ว`

### 2.2 SCUM Watcher / Webhook

- `SCUM_WEBHOOK_PORT`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_WEBHOOK_SECRET`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_WEBHOOK_MAX_BODY_BYTES`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_WEBHOOK_REQUEST_TIMEOUT_MS`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_LOG_PATH`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_WEBHOOK_URL`
  - สถานะ: `ตั้งแล้ว`
- watcher tuning กลุ่ม
  - สถานะ: `ตั้งแล้วบางส่วน`
  - หมายเหตุ: ค่าหลักมีครบ แต่กลุ่ม alert thresholds บางตัวไม่ได้ใส่ explicit ในไฟล์จริงและอาศัย default

### 2.3 Item icons / manifest

- `SCUM_ITEMS_INDEX_PATH`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_ITEMS_DIR_PATH`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_ITEMS_BASE_URL`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_ITEMS_IGNORE_INDEX_URL`
  - สถานะ: `ตั้งแล้ว`
- `SCUM_ITEM_MANIFEST_PATH`
  - สถานะ: `ตั้งแล้ว`

### 2.4 Admin Web

- `ADMIN_WEB_HOST`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_PORT`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_USER`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_PASSWORD`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_SESSION_TTL_HOURS`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_SECURE_COOKIE`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_TOKEN`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_MAX_BODY_BYTES`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_ALLOW_TOKEN_QUERY`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_ENFORCE_ORIGIN_CHECK`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_TRUST_PROXY`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_ALLOWED_ORIGINS`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_HSTS_ENABLED`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_HSTS_MAX_AGE_SEC`
  - สถานะ: `ตั้งแล้ว`

ค่ากลุ่มนี้ถูกใส่ explicit แล้วในไฟล์จริง
- `ADMIN_WEB_LOGIN_WINDOW_MS`
- `ADMIN_WEB_LOGIN_MAX_ATTEMPTS`
- `ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS`
- `ADMIN_WEB_LOGIN_SPIKE_THRESHOLD`
- `ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD`
- `ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS`
- `ADMIN_DASHBOARD_CARDS_CACHE_WINDOW_MS`

หมายเหตุ
- ปิด gap นี้แล้วในไฟล์จริง

### 2.5 Admin Discord SSO

- `ADMIN_WEB_SSO_DISCORD_ENABLED`
  - สถานะ: `ตั้งแล้ว`
  - ค่าปัจจุบัน: ปิด
- `ADMIN_WEB_SSO_DISCORD_CLIENT_ID`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_SSO_DISCORD_REDIRECT_URI`
  - สถานะ: `ตั้งแล้ว`
- `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET`
  - สถานะ: `ยังเป็น placeholder`

ผลกระทบ
- ถ้าจะเปิด admin Discord SSO จริง ต้องใส่ secret จริงก่อน

### 2.6 Database / Persistence

- `NODE_ENV`
  - สถานะ: `ตั้งแล้ว`
  - ค่าปัจจุบัน: production
- `PERSIST_REQUIRE_DB`
  - สถานะ: `ตั้งแล้ว`
- `PERSIST_LEGACY_SNAPSHOTS`
  - สถานะ: `ตั้งแล้ว`
- `DATABASE_URL`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: `ยังไม่ตรง baseline`

จุดที่ยังต้องแก้
- baseline ใช้ `./prisma/production.db`
- ไฟล์จริงยังใช้ `./prisma/dev.db`

นี่คือจุดที่ควรแก้ก่อนขึ้น production จริง

### 2.7 Delivery / Agent

- `DELIVERY_EXECUTION_MODE`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: `จงใจต่างจาก baseline`
  - เหตุผล: environment นี้พิสูจน์แล้วว่า `agent mode` ใช้งานได้จริง ส่วน direct RCon spawn ยังไม่ใช้งานจริง

- `RCON_HOST`
  - สถานะ: `ตั้งแล้ว`
- `RCON_PORT`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: `จงใจต่างจาก baseline`
- `RCON_PASSWORD`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: ควรหมุนใหม่เพราะมีการเปิดเผยในบทสนทนา/terminal
- `RCON_PROTOCOL`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: `จงใจต่างจาก baseline`
- `RCON_EXEC_TEMPLATE`
  - สถานะ: `ตั้งแล้ว`

- `SCUM_CONSOLE_AGENT_*`
  - สถานะ: `ตั้งแล้วครบ`
- `DELIVERY_AGENT_PRE_COMMANDS_JSON`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: `จงใจต่างจาก baseline`
- `DELIVERY_AGENT_POST_COMMANDS_JSON`
  - สถานะ: `ตั้งแล้ว`
- `DELIVERY_AGENT_COMMAND_DELAY_MS`
  - สถานะ: `ตั้งแล้ว`
- `DELIVERY_AGENT_POST_TELEPORT_DELAY_MS`
  - สถานะ: `ตั้งแล้ว`
- `DELIVERY_MAGAZINE_STACKCOUNT`
  - สถานะ: `ตั้งแล้ว`
- `DELIVERY_AGENT_TELEPORT_MODE`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: `จงใจต่างจาก baseline`
- `DELIVERY_AGENT_TELEPORT_TARGET`
  - สถานะ: `ตั้งแล้ว`
  - หมายเหตุ: ใช้รถ `50118` เป็นจุดส่งของคงที่

ค่ากลุ่มนี้ถูกใส่ explicit แล้วในไฟล์จริง
- `DELIVERY_METRICS_WINDOW_MS`
- `DELIVERY_FAIL_RATE_ALERT_THRESHOLD`
- `DELIVERY_FAIL_RATE_ALERT_MIN_SAMPLES`
- `DELIVERY_QUEUE_ALERT_THRESHOLD`
- `DELIVERY_ALERT_COOLDOWN_MS`
- `DELIVERY_QUEUE_STUCK_SLA_MS`
- `DELIVERY_IDEMPOTENCY_SUCCESS_WINDOW_MS`

หมายเหตุ
- ปิด gap นี้แล้วในไฟล์จริง

### 2.8 Runtime split

ตั้งถูกแล้ว
- `BOT_ENABLE_SCUM_WEBHOOK=true`
- `BOT_ENABLE_RESTART_SCHEDULER=true`
- `BOT_ENABLE_ADMIN_WEB=true`
- `BOT_ENABLE_RENTBIKE_SERVICE=false`
- `BOT_ENABLE_DELIVERY_WORKER=false`
- `BOT_ENABLE_OPS_ALERT_ROUTE=true`
- `BOT_HEALTH_PORT=3210`
- `WORKER_ENABLE_RENTBIKE=true`
- `WORKER_ENABLE_DELIVERY=true`
- `WORKER_HEALTH_PORT=3211`
- `SCUM_WATCHER_HEALTH_PORT=3212`

ค่ากลุ่มนี้ถูกใส่ explicit แล้วในไฟล์จริง
- `WORKER_HEARTBEAT_MS`

หมายเหตุ
- ปิด gap นี้แล้วในไฟล์จริง

---

## 3. Player Portal `.env` เทียบ production baseline

### 3.1 Core portal

- `NODE_ENV`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_MODE`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_HOST`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_PORT`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_BASE_URL`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_LEGACY_ADMIN_URL`
  - สถานะ: `ตั้งแล้ว`

### 3.2 Session / security

- `WEB_PORTAL_SESSION_TTL_HOURS`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_SECURE_COOKIE`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_COOKIE_SAMESITE`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_ENFORCE_ORIGIN_CHECK`
  - สถานะ: `ตั้งแล้ว`

### 3.3 Discord OAuth

- `WEB_PORTAL_DISCORD_CLIENT_ID`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_DISCORD_REDIRECT_PATH`
  - สถานะ: `ตั้งแล้ว`
  - ค่าปัจจุบัน: `/auth/discord/callback`
- `WEB_PORTAL_DISCORD_CLIENT_SECRET`
  - สถานะ: `ยังว่าง`

ผลกระทบ
- portal จะ fallback ไปใช้ `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET`
- แต่ไฟล์ root ตอนนี้ตัวนั้นยังเป็น placeholder
- ดังนั้น `readiness:prod` ยังไม่ควรถือว่าปิดรอบ OAuth แล้ว

### 3.4 Player auth policy

- `WEB_PORTAL_PLAYER_OPEN_ACCESS`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_DISCORD_GUILD_ID`
  - สถานะ: `ว่างได้`
- `WEB_PORTAL_REQUIRE_GUILD_MEMBER`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_ALLOWED_DISCORD_IDS`
  - สถานะ: `ว่างได้`

### 3.5 Runtime / cleanup

- `WEB_PORTAL_OAUTH_STATE_TTL_MS`
  - สถานะ: `ตั้งแล้ว`
- `WEB_PORTAL_CLEANUP_INTERVAL_MS`
  - สถานะ: `ตั้งแล้ว`

### 3.6 กลุ่มที่ยังไม่ตั้งในไฟล์จริง

- `SCUM_ITEMS_INDEX_PATH`
- `SCUM_ITEMS_DIR_PATH`
- `SCUM_ITEMS_BASE_URL`
- `SCUM_ITEMS_IGNORE_INDEX_URL`
- `WEB_PORTAL_MAP_EMBED_ENABLED`
- `WEB_PORTAL_MAP_EXTERNAL_URL`
- `WEB_PORTAL_MAP_EMBED_URL`

หมายเหตุ
- ปิด gap นี้แล้วในไฟล์จริง

---

## 4. ลำดับที่ควรแก้ต่อ

### สำคัญก่อน
1. เปลี่ยน `DATABASE_URL` จาก `dev.db` ไป `production.db` หรือ DB production จริง
2. ใส่ `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET` จริง
3. ใส่ `WEB_PORTAL_DISCORD_CLIENT_SECRET` จริง หรือยืนยันว่าจะ fallback จาก root secret เดียวกัน
4. หมุน secret ที่เคยถูกเปิดเผย
   - Discord token
   - RCon password
   - admin token ถ้ามีการเผย

### แนะนำให้ใส่ explicit เพิ่ม
1. กลุ่ม `SCUM_ITEMS_*`
2. กลุ่ม alert thresholds
3. กลุ่ม dashboard cache / login spike / worker heartbeat
4. กลุ่ม map embed ของ portal

---

## 5. คำสั่งเช็กหลังแก้ `.env`

```bat
npm run doctor
npm run doctor:topology:prod
npm run doctor:web-standalone:prod
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```
