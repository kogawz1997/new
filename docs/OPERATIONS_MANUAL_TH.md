# คู่มือใช้งานและตั้งค่าระบบ SCUM TH Bot

เอกสารนี้เป็นคู่มือปฏิบัติการหลักของระบบ ใช้สำหรับติดตั้ง, ตั้งค่า, รัน, ทดสอบ, ตรวจสุขภาพ และดูแลระบบในงานจริง

อัปเดตล่าสุด: **2026-03-15**
สถานะอ้างอิง: `npm test` ผ่าน `119/119`, `npm run lint` ผ่าน

เอกสารที่เกี่ยวข้อง
- ภาพรวมระบบ: [README.md](../README.md)
- อธิบายตัวแปร `.env` ทุกไฟล์: [ENV_REFERENCE_TH.md](./ENV_REFERENCE_TH.md)
- รายงาน gap ระหว่าง `.env` จริงกับ production baseline: [PRODUCTION_ENV_GAP_TH.md](./PRODUCTION_ENV_GAP_TH.md)
- คู่มือแอดมินใช้งานประจำวัน: [ADMIN_DAILY_OPERATIONS_TH.md](./ADMIN_DAILY_OPERATIONS_TH.md)
- สถานะและ roadmap: [PROJECT_HQ.md](../PROJECT_HQ.md)
- deployment เพิ่มเติม: [DEPLOYMENT_STORY.md](./DEPLOYMENT_STORY.md)

---

## 1. โครงสร้าง runtime

ระบบนี้ไม่ได้เป็น single-process bot แล้ว ควรมองเป็น runtime แยกดังนี้

1. `bot`
- Discord slash commands
- panel / button / modal
- economy / shop / vip / ticket / event / bounty

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
- safe restore guardrails + runtime supervisor + notification center

5. `player portal`
- เว็บผู้เล่น login ผ่าน Discord
- dashboard / profile / wallet / shop / orders

6. `console agent`
- bridge คำสั่งจาก worker ไปยัง SCUM admin client
- ใช้กับ `agent mode`

---

## 2. โหมดส่งของ

### 2.1 RCon mode
ใช้เมื่อเซิร์ฟเวอร์รองรับการ execute `#SpawnItem` ผ่าน remote command จริง

ตั้งค่าโดยใช้:
- `DELIVERY_EXECUTION_MODE=rcon`
- `RCON_HOST`
- `RCON_PORT`
- `RCON_PASSWORD`
- `RCON_PROTOCOL=source|battleye`

### 2.2 Agent mode
ใช้เมื่อ `BattlEye login ได้ แต่ #SpawnItem ไม่ execute`

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

สถานะปัจจุบันของระบบนี้:
- โหมดที่ยืนยันใช้งานจริงแล้วคือ `agent mode`
- ยืนยันแล้วว่า `announce -> teleport -> spawn` ใช้งานได้จริง
- รองรับ multi-item และ magazine auto stackcount

---

## 3. สิ่งที่ต้องมีล่วงหน้า

### 3.1 ฝั่งเครื่องรันระบบ
- Node.js 20+
- npm
- Windows ถ้าจะใช้ `agent mode` แบบเปิด SCUM client ค้างไว้
- สิทธิ์อ่าน/เขียนไฟล์ใน project

### 3.2 ฝั่ง Discord
- Bot token
- Application client id
- Guild id

### 3.3 ฝั่ง SCUM
- SCUM Dedicated Server
- path ไปยัง `SCUM.log`
- ถ้าใช้ `agent mode`
  - ต้องมี SCUM client จริงเปิดค้างไว้
  - ล็อกอินด้วยบัญชีแอดมิน
  - อยู่ในเซิร์ฟเวอร์
  - ช่องคำสั่งในเกมต้องเป็น admin channel ที่ script จับได้ถูก

---

## 4. ติดตั้งครั้งแรก

### 4.1 แบบเร็ว (Windows)

```bat
npm run setup:easy
```

สิ่งที่สคริปต์ทำ
- สร้าง `.env` จาก `.env.example` ถ้ายังไม่มี
- สร้าง `apps/web-portal-standalone/.env` ถ้ายังไม่มี
- ติดตั้ง package
- generate Prisma client
- db push

### 4.2 แบบ manual

```bat
npm install
copy .env.example .env
cmd /c npx.cmd prisma generate --schema prisma\schema.prisma
cmd /c npx.cmd prisma db push --schema prisma\schema.prisma
npm run doctor
```

ถ้าจะเริ่มจาก production baseline

```bat
copy .env.production.example .env
```

---

## 5. ไฟล์ `.env` ที่ต้องรู้

### 5.1 root env
- [`.env`](../.env)
- [`.env.example`](../.env.example)
- [`.env.production.example`](../.env.production.example)

### 5.2 player portal env
- [`apps/web-portal-standalone/.env`](../apps/web-portal-standalone/.env)
- [`apps/web-portal-standalone/.env.example`](../apps/web-portal-standalone/.env.example)
- [`apps/web-portal-standalone/.env.production.example`](../apps/web-portal-standalone/.env.production.example)

---

## 6. ค่าหลักใน root `.env`

### 6.1 Discord

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
```

### 6.2 Database

```env
DATABASE_URL="file:./prisma/dev.db"
PERSIST_REQUIRE_DB=true
PERSIST_LEGACY_SNAPSHOTS=false
```

คำแนะนำ production
- `NODE_ENV=production`
- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`

### 6.3 Watcher / Webhook

```env
SCUM_LOG_PATH=C:\\Path\\To\\SCUM.log
SCUM_WEBHOOK_PORT=3100
SCUM_WEBHOOK_SECRET=
SCUM_WEBHOOK_URL=http://127.0.0.1:3100/scum-event
```

### 6.4 Runtime split

```env
BOT_ENABLE_SCUM_WEBHOOK=true
BOT_ENABLE_RESTART_SCHEDULER=true
BOT_ENABLE_ADMIN_WEB=true
BOT_ENABLE_RENTBIKE_SERVICE=false
BOT_ENABLE_DELIVERY_WORKER=false
BOT_ENABLE_OPS_ALERT_ROUTE=true

WORKER_ENABLE_RENTBIKE=true
WORKER_ENABLE_DELIVERY=true
```

กติกา
- ถ้าใช้ `worker` แยก process แล้ว อย่าเปิด `BOT_ENABLE_DELIVERY_WORKER=true`
- อย่าเปิด delivery worker ซ้ำทั้ง bot และ worker พร้อมกัน

### 6.5 Admin Web

```env
ADMIN_WEB_HOST=127.0.0.1
ADMIN_WEB_PORT=3200
ADMIN_WEB_ALLOWED_ORIGINS=https://admin.genz.noah-dns.online
ADMIN_WEB_SECURE_COOKIE=true
ADMIN_WEB_TRUST_PROXY=true
ADMIN_DASHBOARD_CARDS_CACHE_WINDOW_MS=15000
```

---

## 7. ตั้งค่า Agent Mode

ค่าหลักที่ใช้จริงตอนนี้

```env
DELIVERY_EXECUTION_MODE=agent

SCUM_CONSOLE_AGENT_BASE_URL=http://127.0.0.1:3213
SCUM_CONSOLE_AGENT_HOST=127.0.0.1
SCUM_CONSOLE_AGENT_PORT=3213
SCUM_CONSOLE_AGENT_TOKEN=put_a_strong_agent_token_here
SCUM_CONSOLE_AGENT_BACKEND=exec
SCUM_CONSOLE_AGENT_COMMAND_TIMEOUT_MS=15000
SCUM_CONSOLE_AGENT_ALLOW_NON_HASH=false

DELIVERY_AGENT_PRE_COMMANDS_JSON=["#TeleportToVehicle {teleportTargetRaw}"]
DELIVERY_AGENT_POST_COMMANDS_JSON=[]
DELIVERY_AGENT_COMMAND_DELAY_MS=600
DELIVERY_AGENT_POST_TELEPORT_DELAY_MS=2000
DELIVERY_MAGAZINE_STACKCOUNT=100
DELIVERY_AGENT_TELEPORT_MODE=vehicle
DELIVERY_AGENT_TELEPORT_TARGET=50118
DELIVERY_AGENT_RETURN_TARGET=

SCUM_CONSOLE_AGENT_EXEC_TEMPLATE=powershell -NoProfile -ExecutionPolicy Bypass -File scripts/send-scum-admin-command.ps1 -WindowTitle "SCUM" -SwitchToAdminChannel -AdminChannelTabs 3 -Command "{command}"
```

ความหมาย
- `DELIVERY_AGENT_COMMAND_DELAY_MS`
  - delay ปกติระหว่างคำสั่ง
- `DELIVERY_AGENT_POST_TELEPORT_DELAY_MS`
  - delay หลัง teleport ก่อน spawn
- `DELIVERY_MAGAZINE_STACKCOUNT`
  - เติม `StackCount` ให้แม็กอัตโนมัติ เช่น `Magazine_M1911`
- `DELIVERY_AGENT_TELEPORT_MODE=vehicle`
  - ใช้ `#TeleportToVehicle`
- `DELIVERY_AGENT_TELEPORT_TARGET=50118`
  - จุดส่งของคงที่

หมายเหตุการใช้งานจริง
- ถ้า command ไปลงแชตโลกแทน admin channel ให้ปรับ `-AdminChannelTabs`
- ค่าที่มักใช้คือ `1`, `2`, `3`
- สำหรับเครื่องปัจจุบัน ค่าที่ใช้คือ `3`

---

## 8. ตั้งค่า SCUM ฝั่งแอดมิน

### 8.1 สิทธิ์ admin ของผู้เล่นในเกม
แก้ไฟล์ `AdminUsers.ini`

ตัวอย่าง

```ini
76561199274778326[GodMode]
```

ถ้าจะให้บัญชีนี้แก้ server settings ได้ด้วย ให้เพิ่มใน `ServerSettingsAdminUsers.ini`

หลังแก้ไฟล์
- `rejoin` หรือ `restart server` อย่างน้อย 1 รอบ

### 8.2 ข้อควรระวังเรื่อง instance
อย่ารัน SCUM server หลายตัวใช้ save path เดียวกัน

ตรวจด้วย

```bat
npm run scum:audit
```

ถ้าจะ cleanup instance ซ้ำ

```bat
npm run scum:cleanup
```

---

## 9. การรันระบบ

### 9.1 รันแบบแยก process

```bat
npm run start:bot
npm run start:worker
npm run start:watcher
npm run start:scum-agent
npm run start:web-standalone
```

### 9.2 รันด้วย PM2

local

```bat
npm run pm2:start:local
```

production

```bat
npm run pm2:start:prod
```

Windows helper
- `deploy\start-production-stack.cmd`
- `deploy\reload-production-stack.cmd`
- `deploy\stop-production-stack.cmd`

---

## 10. วิธีทดสอบ delivery

### 10.1 preview command

```bat
npm run preview:spawn -- --game-item-id Weapon_M1911 --quantity 1
npm run preview:spawn -- --game-item-id Magazine_M1911 --quantity 1
```

### 10.2 ยิงคำสั่งผ่าน agent ตรง ๆ

```bat
npm run scum:agent:exec -- --command "#Announce HELLO"
npm run scum:agent:exec -- --command "#TeleportToVehicle 50118"
npm run scum:agent:exec -- --command "#SpawnItem Weapon_M1911 1"
npm run scum:agent:exec -- --command "#SpawnItem Magazine_M1911 1 StackCount 100"
```

### 10.3 multi-item delivery ที่ยืนยันแล้ว

```text
#TeleportToVehicle 50118
#SpawnItem Weapon_M1911 1
#SpawnItem Magazine_M1911 2 StackCount 100
#SpawnItem Cal_45_Ammobox 1
```

### 10.4 logic submit ที่ใช้ตอนนี้
- `#Announce` -> submit 2 รอบ
- `#SpawnItem` -> submit 2 รอบ
- `#TeleportToVehicle` -> submit 1 รอบ

---

## 11. Delivery Profile รายสินค้า

ตั้งได้จากหน้าแอดมินตอนเพิ่มสินค้า

ค่า profile
- `spawn_only`
- `teleport_spawn`
- `announce_teleport_spawn`

ค่า teleport mode
- `player`
- `vehicle`

ฟิลด์สำคัญระดับสินค้า
- `deliveryProfile`
- `deliveryTeleportMode`
- `deliveryTeleportTarget`
- `deliveryReturnTarget`
- `deliveryPreCommands`
- `deliveryPostCommands`

ลำดับหา teleport target
1. ค่าในสินค้า
2. `DELIVERY_AGENT_TELEPORT_TARGET`
3. `inGameName` จากระบบ link

ถ้า profile ต้อง teleport แต่หา target ไม่เจอ
- worker จะ `retry`

---

## 12. Admin Web ที่ควรใช้ในงานจริง

Admin Web มีเครื่องมือหลักเหล่านี้

### Delivery
- Delivery Runtime
- Delivery Preview
- Delivery Timeline / Step Log
- Delivery Preflight Check
- Delivery Simulator / Dry Run
- queue / dead-letter
- detail / command log / test send
- Alert / Notification Center
- Item Command Editor + command template preview

### Audit Center
รองรับ filter ลึก
- q
- user
- actor
- reason
- status
- reference
- dateFrom
- dateTo
- window

รองรับ
- exact filter
- sort/order
- page + cursor pagination
- saved presets แบบแชร์ผ่าน DB (`private / role / public`)
- export `CSV / JSON`

### Observability
- dashboard cards aggregate endpoint
- metrics export ฝั่ง server
- cache window ลด query ซ้ำ

---

## 13. Player Portal

เส้นทางหลัก
- local: `http://127.0.0.1:3300/player`
- production: `https://player.genz.noah-dns.online`

รองรับ
- Discord login
- profile / steam link
- dashboard
- wallet / purchases
- shop / redeem
- mission / rent bike / leaderboard บางส่วน

---

## 14. Item / Icon / Command Mapping

แหล่งข้อมูลหลัก
- [`scum_weapons_from_wiki.json`](../scum_weapons_from_wiki.json)
- [`scum_item_category_manifest.json`](../scum_item_category_manifest.json)
- [`scum_items-main/index.json`](../scum_items-main/index.json)

ลำดับ resolve command
1. `delivery.auto.itemCommands`
2. wiki weapon fallback
3. manifest fallback

ลำดับ resolve icon
1. `index.json`
2. canonical/alias normalize
3. directory fallback

---

## 15. การตรวจสุขภาพก่อนขึ้นจริง

```bat
npm run doctor
  npm run doctor:topology
  npm run doctor:web-standalone
  npm run security:check
  npm run readiness:prod
  npm run smoke:postdeploy
  ```

  หมายเหตุ `smoke:postdeploy`
  - ค่า default จะตรวจ `admin` ผ่าน local admin web และยอมรับ `player portal` ที่ตอบแบบ canonical redirect ไปโดเมนจริง
  - ถ้าจะเช็กผ่าน reverse proxy/public URL โดยตรง ให้ตั้ง `SMOKE_ADMIN_BASE_URL` และ `SMOKE_PLAYER_BASE_URL`
  
  สิ่งที่คำสั่งเหล่านี้ช่วยตรวจ
- env ครบหรือไม่
- split runtime ถูกหรือไม่
- reverse proxy / origin / redirect สอดคล้องหรือไม่
- security baseline ผ่านหรือไม่
- post-deploy smoke ผ่านหรือไม่

---

## 16. ผลทดสอบล่าสุด

คำสั่งที่อ้างอิงล่าสุด

```bat
npm run lint
npm test
```

ผลล่าสุด
- `npm run lint` ผ่าน
- `npm test` ผ่าน `119/119`

ชุดทดสอบครอบคลุม
- admin API / RBAC / SSO / presets / capability catalog
- delivery queue / agent mode / teleport / multi-item / magazine stackcount / post-spawn verification
- rent bike flow
- watcher / webhook
- wallet ledger / purchase state machine
- player portal / JSON serialization / observability

---

## 17. ปัญหาที่เจอบ่อย

### 17.1 command ไปลงแชตโลก
- ปรับ `-AdminChannelTabs`
- เช็กว่า SCUM client อยู่ channel ที่ถูก

### 17.2 BattlEye login ได้แต่เสกของไม่ได้
- สลับไป `agent mode`

### 17.3 วาร์ปได้แต่ spawn ไม่ออก
- เพิ่ม `DELIVERY_AGENT_POST_TELEPORT_DELAY_MS`
- ตรวจ canonical `gameItemId`
- ตรวจว่า item ต้องมี modifier พิเศษหรือไม่ เช่นแม็ก

### 17.4 magazine เสกแล้วลูกไม่เต็ม
- ตั้ง `DELIVERY_MAGAZINE_STACKCOUNT=100`
- ตรวจว่า template ไม่ override `StackCount` เองด้วยค่าที่ผิด

### 17.5 login portal หรือ admin redirect แปลก
- รัน `npm run doctor`
- รัน `npm run doctor:web-standalone`
- เช็ก redirect URI ใน Discord Developer Portal

---

## 18. Checklist production สั้น ๆ

ก่อนเปิดใช้งานจริง
- หมุน token/secret ทั้งหมด
- ใส่ OAuth secret จริง
- ใช้ `NODE_ENV=production`
- ใช้ `PERSIST_REQUIRE_DB=true`
- ใช้ `PERSIST_LEGACY_SNAPSHOTS=false`
- รัน
  - `npm run doctor`
  - `npm run security:check`
  - `npm run readiness:prod`
  - `npm run smoke:postdeploy`

ถ้าใช้ agent mode
- เปิด SCUM admin client ค้างไว้
- อย่า lock session Windows
- อย่าปล่อยหลาย server instance ชน save path เดียวกัน

---

## 19. อ้างอิงไฟล์สำคัญ

- bot: [`src/bot.js`](../src/bot.js)
- worker: [`src/worker.js`](../src/worker.js)
- delivery: [`src/services/rconDelivery.js`](../src/services/rconDelivery.js)
- console agent: [`src/services/scumConsoleAgent.js`](../src/services/scumConsoleAgent.js)
- bridge script: [`scripts/send-scum-admin-command.ps1`](../scripts/send-scum-admin-command.ps1)
- admin web: [`src/adminWebServer.js`](../src/adminWebServer.js)
- player portal: [`apps/web-portal-standalone/server.js`](../apps/web-portal-standalone/server.js)
- config: [`src/config.js`](../src/config.js)
