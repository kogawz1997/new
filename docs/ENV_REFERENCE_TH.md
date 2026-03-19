# คู่มืออธิบายตัวแปร `.env` ทุกไฟล์

เอกสารนี้อธิบายความหมายของตัวแปรตั้งค่าทุกไฟล์ที่ใช้จริงในโปรเจกต์นี้

อัปเดตล่าสุด: **2026-03-13**

ไฟล์ที่เกี่ยวข้อง

- root local: [../.env.example](../.env.example)
- root production: [../.env.production.example](../.env.production.example)
- player portal local: [../apps/web-portal-standalone/.env.example](../apps/web-portal-standalone/.env.example)
- player portal production: [../apps/web-portal-standalone/.env.production.example](../apps/web-portal-standalone/.env.production.example)

หลักการใช้งาน

- `.env.example` ใช้เป็น template สำหรับเครื่องพัฒนา/เครื่อง local
- `.env.production.example` ใช้เป็น baseline สำหรับเครื่อง production
- ไฟล์ `.env` จริงควรคัดลอกจาก example ที่ตรงกับสภาพแวดล้อม แล้วแก้เฉพาะค่าที่ต้องใช้จริง
- ถ้าตัวแปรเดียวกันมีทั้งใน root และ player portal:
  - ฝั่ง portal จะใช้ค่าจาก `apps/web-portal-standalone/.env` ก่อน
  - ถ้าไม่ได้ตั้งไว้ บางตัวจะ fallback ไปใช้ค่าใน root `.env`

---

## 1. Root `.env` / `.env.example` / `.env.production.example`

ไฟล์กลุ่มนี้ใช้กับ runtime หลักของระบบ:

- Discord bot
- worker
- watcher
- admin web
- delivery worker
- console agent

### 1.1 Discord Bot

- `DISCORD_TOKEN`
  - token ของ Discord bot
  - production ต้องใช้ค่าจริงจาก Discord Developer Portal
- `DISCORD_CLIENT_ID`
  - application client id ของบอท
  - ใช้กับ slash commands และ OAuth fallback บางส่วน
- `DISCORD_GUILD_ID`
  - guild หลักที่ใช้ register/test คำสั่ง

### 1.2 SCUM Webhook Server และ Log Watcher

- `SCUM_WEBHOOK_PORT`
  - พอร์ตของ webhook server ฝั่งบอท
- `SCUM_WEBHOOK_SECRET`
  - shared secret ระหว่าง watcher กับ bot
- `SCUM_WEBHOOK_MAX_BODY_BYTES`
  - จำกัดขนาด body ของ webhook request
- `SCUM_WEBHOOK_REQUEST_TIMEOUT_MS`

  - timeout ฝั่ง webhook server

- `SCUM_LOG_PATH`
  - path ไปไฟล์ `SCUM.log`
  - Windows ต้อง escape backslash เช่น `D:\\SCUMServer\\SCUM.log`
- `SCUM_WEBHOOK_URL`

  - URL ที่ watcher ใช้ยิง event เข้า bot

- `SCUM_WATCH_INTERVAL_MS`
  - interval ของ file polling
- `SCUM_WEBHOOK_TIMEOUT_MS`
  - timeout ฝั่ง watcher ตอนส่ง webhook
- `SCUM_WEBHOOK_MAX_RETRIES`
  - จำนวน retry สูงสุดต่อ event
- `SCUM_WEBHOOK_RETRY_DELAY_MS`
  - delay พื้นฐานระหว่าง retry
- `SCUM_EVENT_DEDUP_WINDOW_MS`
  - dedupe window ของ event ที่ซ้ำ
- `SCUM_EVENT_DEDUPE_TRACK_SIZE`
  - ขนาด track set ของ dedupe
- `SCUM_EVENT_QUEUE_MAX`
  - ความยาว queue สูงสุดของ watcher
- `SCUM_DEAD_LETTER_LOG_PATH`

  - path log ของ dead-letter ฝั่ง watcher

- `SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS`
  - ช่วงเวลาที่ใช้คำนวณ error rate
- `SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS`
  - ขั้นต่ำของจำนวน request ก่อนคำนวณ alert
- `SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD`
  - threshold error rate ที่เริ่ม alert
- `SCUM_QUEUE_ALERT_THRESHOLD`
  - threshold queue length ที่เริ่ม alert
- `SCUM_ALERT_COOLDOWN_MS`
  - cooldown ระหว่าง alert watchdog

### 1.3 Item Icons และ Manifest

- `SCUM_ITEMS_INDEX_PATH`
  - path ไป `index.json` ของคลังไอคอน
- `SCUM_ITEMS_DIR_PATH`
  - path ไปโฟลเดอร์ไอคอนไฟล์จริง
- `SCUM_ITEMS_BASE_URL`
  - base URL ที่ใช้ประกอบ link รูปไอคอน
  - ถ้าจะให้ Discord เห็นรูป ต้องเป็น URL ภายนอกที่เข้าถึงได้จริง
- `SCUM_ITEMS_IGNORE_INDEX_URL`
  - ถ้า `true` จะไม่ใช้ field `url` ใน index
  - ระบบจะประกอบ URL ใหม่จาก `filename` + `SCUM_ITEMS_BASE_URL`
- `SCUM_ITEM_MANIFEST_PATH`
  - path ไปไฟล์ manifest รวมหมวดสินค้า/รูปแบบคำสั่ง

### 1.4 Admin Web

- `ADMIN_WEB_HOST`
  - host ที่ admin web bind
- `ADMIN_WEB_PORT`
  - พอร์ตของ admin web
- `ADMIN_WEB_USER`
  - ชื่อผู้ใช้ bootstrap กรณีตารางผู้ใช้ยังว่าง
- `ADMIN_WEB_PASSWORD`
  - รหัสผ่าน bootstrap
- `ADMIN_WEB_USERS_JSON`

  - bootstrap ผู้ใช้หลายคนแบบ JSON

- `ADMIN_WEB_SESSION_TTL_HOURS`
  - อายุ session ของแอดมิน
- `ADMIN_WEB_SESSION_COOKIE_NAME`
  - ชื่อ cookie สำหรับ session (ค่า default: `scum_admin_session`)
- `ADMIN_WEB_SESSION_COOKIE_PATH`
  - path ของ cookie (ค่า default: `/admin`)
- `ADMIN_WEB_SESSION_COOKIE_SAMESITE`
  - ค่า SameSite ของ cookie (รองรับ `Strict|Lax|None`)
  - ค่า default: `Strict` (แนะนำสำหรับ security)
- `ADMIN_WEB_SESSION_COOKIE_DOMAIN`
  - domain สำหรับ scope ของ cookie (ค่า default: ว่าง = ผูกกับ host ปัจจุบัน)
- `ADMIN_WEB_SESSION_IDLE_MINUTES`
  - หมดอายุเมื่อ idle เกินกี่นาที (ค่า default: `120`)
- `ADMIN_WEB_SESSION_MAX_PER_USER`
  - จำกัดจำนวน session ต่อผู้ใช้ (ค่า default: `5`)
- `ADMIN_WEB_SESSION_BIND_USER_AGENT`
  - บังคับให้ session ถูก bind กับ `User-Agent` เพื่อกันการขโมย session (ค่า default: `true`)
- `ADMIN_WEB_2FA_ENABLED`
  - เปิด 2FA สำหรับ admin login
- `ADMIN_WEB_2FA_SECRET`
  - secret สำหรับ TOTP ของ admin web
- `ADMIN_WEB_STEP_UP_ENABLED`
  - บังคับ step-up auth สำหรับ mutation เสี่ยง เช่น config / restore / bulk / platform secrets
- `ADMIN_WEB_STEP_UP_TTL_MINUTES`
  - อายุการยืนยัน step-up ต่อ session ก่อนต้องกรอกรหัส 2FA ใหม่
- `ADMIN_WEB_ALLOW_TOKEN_SENSITIVE_MUTATIONS`
  - ถ้า `true` จะอนุญาต token auth (header/query) เข้าถึง endpoint ที่เป็น mutation เสี่ยงโดยไม่ต้อง step-up auth
  - ค่า default: `false` (แนะนำให้ `false` ใน production)
- `ADMIN_WEB_SECURE_COOKIE`
  - `true` เมื่อใช้งานผ่าน HTTPS จริง
- `ADMIN_WEB_HSTS_ENABLED`
  - เปิด HSTS header
- `ADMIN_WEB_HSTS_MAX_AGE_SEC`
  - max-age ของ HSTS
- `ADMIN_WEB_TOKEN`
  - token สำรอง/legacy bootstrap
- `ADMIN_WEB_MAX_BODY_BYTES`
  - จำกัดขนาด request body
- `ADMIN_WEB_TRUST_PROXY`
  - เปิดเมื่อมี reverse proxy ด้านหน้า
- `ADMIN_WEB_ALLOW_TOKEN_QUERY`
  - อนุญาต token ผ่าน query string หรือไม่
- `ADMIN_WEB_ENFORCE_ORIGIN_CHECK`
  - เปิด origin check กัน CSRF
- `ADMIN_WEB_ALLOWED_ORIGINS`

  - origins ที่อนุญาตให้ยิง admin web

- `ADMIN_WEB_LOGIN_WINDOW_MS`
  - ช่วงเวลาคิด rate limit ของ login
- `ADMIN_WEB_LOGIN_MAX_ATTEMPTS`
  - จำนวน login attempts สูงสุดใน window
- `ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS`
  - ช่วงเวลาคิด login spike
- `ADMIN_WEB_LOGIN_SPIKE_THRESHOLD`
  - จำนวนรวมที่ถือว่า spike
- `ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD`
  - จำนวนต่อ IP ที่ถือว่า spike
- `ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS`

  - cooldown ของ alert

- `ADMIN_DASHBOARD_CARDS_CACHE_WINDOW_MS`
  - cache window ของ aggregate dashboard cards
  - ลด query ซ้ำเวลาเปิดหน้า admin ใหญ่

### 1.5 Admin Discord SSO

- `ADMIN_WEB_SSO_DISCORD_ENABLED`
  - เปิด Discord SSO ฝั่ง admin หรือไม่
- `ADMIN_WEB_SSO_DISCORD_CLIENT_ID`
  - client id ของ app OAuth ฝั่ง admin
- `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET`
  - client secret ของ app OAuth ฝั่ง admin
- `ADMIN_WEB_SSO_DISCORD_REDIRECT_URI`
  - redirect URI ของ admin SSO
  - ต้องลงท้ายด้วย `/admin/auth/discord/callback`
- `ADMIN_WEB_SSO_DISCORD_GUILD_ID`
  - guild ที่ใช้ตรวจสิทธิ์เพิ่มเติม
- `ADMIN_WEB_SSO_DEFAULT_ROLE`
  - role ที่ assign ตอน SSO ถ้าไม่มี rule เฉพาะ
- `ADMIN_WEB_SSO_STATE_TTL_MS`
  - อายุ state token ของ OAuth flow

### 1.6 Database / Persistence

- `BOT_DATA_DIR`
  - path data legacy เพิ่มเติม
  - ตอนนี้ใช้เฉพาะกรณีจำเป็น
- `DATABASE_URL`
  - Prisma database URL
  - production ควรชี้ฐานข้อมูลจริงที่ runtime ทุกตัวใช้ร่วมกัน
- `NODE_ENV`
  - `production` หรือ `development`
- `PERSIST_REQUIRE_DB`
  - ถ้า `true` ระบบจะ fail-fast ถ้า DB ใช้ไม่ได้
- `PERSIST_LEGACY_SNAPSHOTS`
  - เปิด legacy file snapshots สำหรับ migration/backup ชั่วคราว
  - production baseline ควรเป็น `false`

### 1.7 Delivery / RCon / Console Agent

- `DELIVERY_EXECUTION_MODE`
  - `rcon` หรือ `agent`
  - environment นี้เคยผ่านการทดสอบ `agent` เมื่อมี Windows session และ SCUM client พร้อม

#### RCon

- `RCON_HOST`
  - host ของ RCon/BattlEye
- `RCON_PORT`
  - พอร์ตของ RCon/BattlEye
- `RCON_PASSWORD`
  - รหัสผ่าน RCon/BattlEye
- `RCON_PROTOCOL`
  - `source` หรือ `battleye`
- `RCON_EXEC_TEMPLATE`
  - command template ของตัวส่ง RCon

#### Console Agent

- `SCUM_CONSOLE_AGENT_BASE_URL`
  - base URL ที่ worker ใช้คุยกับ local console agent
- `SCUM_CONSOLE_AGENT_HOST`
  - host ที่ agent bind
- `SCUM_CONSOLE_AGENT_PORT`
  - พอร์ตของ agent
- `SCUM_CONSOLE_AGENT_TOKEN`
  - token ป้องกันการเรียก agent
- `SCUM_CONSOLE_AGENT_BACKEND`
  - `exec` หรือ `process`
  - production ปัจจุบันใช้ `exec`
- `SCUM_CONSOLE_AGENT_COMMAND_TIMEOUT_MS`
  - timeout ต่อคำสั่ง
- `SCUM_CONSOLE_AGENT_ALLOW_NON_HASH`
  - อนุญาต command ที่ไม่ขึ้นต้นด้วย `#` หรือไม่

#### Delivery hooks / timing

- `DELIVERY_AGENT_PRE_COMMANDS_JSON`
  - คำสั่งก่อน spawn เช่น teleport
- `DELIVERY_AGENT_POST_COMMANDS_JSON`
  - คำสั่งหลัง spawn เช่น return target
- `DELIVERY_AGENT_COMMAND_DELAY_MS`
  - delay พื้นฐานระหว่างคำสั่งทั่วไป
- `DELIVERY_AGENT_POST_TELEPORT_DELAY_MS`
  - delay หลัง teleport ก่อนเริ่ม spawn
- `DELIVERY_MAGAZINE_STACKCOUNT`
  - ค่า `StackCount` อัตโนมัติสำหรับ magazine
- `DELIVERY_AGENT_TELEPORT_MODE`
  - `player` หรือ `vehicle`
- `DELIVERY_AGENT_TELEPORT_TARGET`
  - จุดวาร์ป default เช่น vehicle id/alias
- `DELIVERY_AGENT_RETURN_TARGET`
  - จุดวาร์ปกลับหลังส่งของ

#### Agent backend เพิ่มเติม

- `SCUM_CONSOLE_AGENT_EXEC_TEMPLATE`
  - template ที่ agent ใช้เรียก bridge ภายนอก
- `SCUM_CONSOLE_AGENT_AUTOSTART`
  - ให้ agent start SCUM process เองหรือไม่
- `SCUM_CONSOLE_AGENT_SERVER_EXE`
  - path executable กรณี backend `process`
- `SCUM_CONSOLE_AGENT_SERVER_ARGS_JSON`
  - args ของ process backend
- `SCUM_CONSOLE_AGENT_SERVER_WORKDIR`
  - working directory ของ process backend
- `SCUM_CONSOLE_AGENT_PROCESS_RESPONSE_WAIT_MS`
  - wait time หลังเขียน command เข้า process

#### Delivery watchdog / metrics

- `DELIVERY_METRICS_WINDOW_MS`
  - metrics window
- `DELIVERY_FAIL_RATE_ALERT_THRESHOLD`
  - threshold ของ fail rate
- `DELIVERY_FAIL_RATE_ALERT_MIN_SAMPLES`
  - จำนวน sample ขั้นต่ำก่อนเตือน
- `DELIVERY_QUEUE_ALERT_THRESHOLD`
  - threshold queue length
- `DELIVERY_ALERT_COOLDOWN_MS`
  - cooldown ของ delivery alerts
- `DELIVERY_QUEUE_STUCK_SLA_MS`
  - SLA ของคิวค้าง
- `DELIVERY_IDEMPOTENCY_SUCCESS_WINDOW_MS`
  - idempotency window กันสำเร็จซ้ำ

### 1.8 Runtime Split

#### Bot process

- `BOT_ENABLE_SCUM_WEBHOOK`
  - เปิด webhook server ฝั่ง bot
- `BOT_ENABLE_RESTART_SCHEDULER`
  - เปิด restart scheduler
- `BOT_ENABLE_ADMIN_WEB`
  - เปิด admin web ใน process bot
- `BOT_ENABLE_RENTBIKE_SERVICE`
  - เปิด rent bike service ใน bot
- `BOT_ENABLE_DELIVERY_WORKER`
  - เปิด delivery worker ใน bot
  - ถ้าแยก worker จริง ควรเป็น `false`
- `BOT_ENABLE_OPS_ALERT_ROUTE`
  - เปิด route/ops alerts
- `BOT_HEALTH_HOST`
  - host ของ bot health endpoint
- `BOT_HEALTH_PORT`
  - port ของ bot health endpoint

#### Worker process

- `WORKER_ENABLE_RENTBIKE`
  - เปิด rent bike queue ใน worker
- `WORKER_ENABLE_DELIVERY`
  - เปิด delivery queue ใน worker
- `WORKER_HEARTBEAT_MS`
  - ความถี่ heartbeat ของ worker
- `WORKER_HEALTH_HOST`
  - host ของ worker health endpoint
- `WORKER_HEALTH_PORT`
  - port ของ worker health endpoint

#### Watcher health

- `SCUM_WATCHER_HEALTH_HOST`
  - host ของ watcher health endpoint
- `SCUM_WATCHER_HEALTH_PORT`
  - port ของ watcher health endpoint

---

## 2. Player Portal `.env`

ไฟล์กลุ่มนี้ใช้เฉพาะแอป `apps/web-portal-standalone`

### 2.1 Core portal

- `WEB_PORTAL_MODE`
  - ตอนนี้ใช้ `player`
- `WEB_PORTAL_HOST`
  - host ที่ player portal bind
- `WEB_PORTAL_PORT`
  - พอร์ตของ player portal
- `WEB_PORTAL_BASE_URL`
  - public base URL ของ player portal
- `WEB_PORTAL_LEGACY_ADMIN_URL`
  - URL admin เดิมที่ `/admin*` จะ redirect ไป

### 2.2 Session / security

- `WEB_PORTAL_SESSION_TTL_HOURS`
  - อายุ session ของผู้เล่น
- `WEB_PORTAL_SESSION_COOKIE_NAME`
  - ชื่อ cookie สำหรับ session (ค่า default: `scum_portal_session`)
- `WEB_PORTAL_SESSION_COOKIE_PATH`
  - path ของ cookie (ค่า default: `/`)
- `WEB_PORTAL_COOKIE_DOMAIN`
  - domain สำหรับ scope ของ cookie (ค่า default: ว่าง = ผูกกับ host ปัจจุบัน)
- `WEB_PORTAL_SECURE_COOKIE`
  - `true` เมื่อรันผ่าน HTTPS จริง
- `WEB_PORTAL_COOKIE_SAMESITE`
  - ค่า SameSite ของ cookie (รองรับ `Strict|Lax|None`)
  - ค่า default: `Lax`
- `WEB_PORTAL_ENFORCE_ORIGIN_CHECK`
  - เปิด origin check กัน CSRF

### 2.3 Discord OAuth ฝั่งผู้เล่น

- `WEB_PORTAL_DISCORD_CLIENT_ID`
  - client id ของ player portal
  - ถ้าไม่ตั้ง บาง flow จะ fallback ไป client id จาก root env
- `WEB_PORTAL_DISCORD_CLIENT_SECRET`
  - client secret ของ player portal
  - ถ้าเว้นว่าง ระบบจะ fallback ไป `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET`
- `WEB_PORTAL_DISCORD_REDIRECT_PATH`
  - redirect path ของ player portal
  - path มาตรฐานปัจจุบันคือ `/auth/discord/callback`

### 2.4 Player auth policy

- `WEB_PORTAL_PLAYER_OPEN_ACCESS`
  - `true` = Discord account ใดก็เข้าได้
- `WEB_PORTAL_DISCORD_GUILD_ID`
  - guild สำหรับตรวจสมาชิก เมื่อปิด open access
- `WEB_PORTAL_REQUIRE_GUILD_MEMBER`
  - บังคับให้เป็นสมาชิก guild หรือไม่
- `WEB_PORTAL_ALLOWED_DISCORD_IDS`
  - allowlist เฉพาะ Discord IDs

### 2.5 Item icon source

- `SCUM_ITEMS_INDEX_PATH`
  - path index ไอคอน
- `SCUM_ITEMS_DIR_PATH`
  - path โฟลเดอร์ไอคอน
- `SCUM_ITEMS_BASE_URL`
  - public URL สำหรับเสิร์ฟไฟล์ไอคอน
- `SCUM_ITEMS_IGNORE_INDEX_URL`
  - ใช้ filename + base URL แทน url จาก index

### 2.6 Runtime / cleanup

- `WEB_PORTAL_OAUTH_STATE_TTL_MS`
  - อายุ OAuth state
- `WEB_PORTAL_CLEANUP_INTERVAL_MS`
  - interval cleanup job ของ portal

### 2.7 Map embed

- `WEB_PORTAL_MAP_EMBED_ENABLED`
  - เปิด embed map ใน player portal หรือไม่
- `WEB_PORTAL_MAP_EXTERNAL_URL`
  - URL ปลายทางของแผนที่
- `WEB_PORTAL_MAP_EMBED_URL`
  - URL ที่ใช้ embed

---

## 3. Production baseline ที่ควรใช้จริง

### Root

- `NODE_ENV=production`
- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`
- `BOT_ENABLE_DELIVERY_WORKER=false`
- `WORKER_ENABLE_DELIVERY=true`
- `WORKER_HEALTH_PORT` และ `BOT_HEALTH_PORT` ต้องไม่ชนกัน

### Portal

- `WEB_PORTAL_SECURE_COOKIE=true`
- `WEB_PORTAL_BASE_URL` ต้องเป็น `https://...`
- `WEB_PORTAL_DISCORD_REDIRECT_PATH=/auth/discord/callback`

### Admin SSO

- `ADMIN_WEB_SSO_DISCORD_REDIRECT_URI` ต้องลงท้ายด้วย
  - `/admin/auth/discord/callback`

---

## 4. หมายเหตุสำคัญเรื่อง callback path

ปัจจุบันระบบรองรับ 2 path นี้:

- player portal: `/auth/discord/callback`
- admin SSO: `/admin/auth/discord/callback`

ห้ามสลับกัน เพราะ role และ route คนละฝั่ง

---

## 5. วิธีเช็กว่าตั้งค่าเสร็จแล้ว

รันตามนี้

```bat
npm run doctor
npm run doctor:topology:prod
npm run doctor:web-standalone:prod
npm run security:check
npm run readiness:prod
```

ถ้าจะตรวจ production หลัง deploy แล้ว

```bat
npm run smoke:postdeploy
```
