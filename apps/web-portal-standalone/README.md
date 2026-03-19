# Standalone SCUM Player Portal

เว็บนี้เป็น **Player Portal แบบแยก process** และ **ไม่พึ่ง `/admin/api`** จากบอทหลัก

- โค้ดเว็บ: `apps/web-portal-standalone/`
- บอทหลัก: `src/bot.js`
- โหมดเว็บนี้: `player-only`
- เส้นทาง `/admin*` บนเว็บนี้: redirect ไป admin เดิมด้วย `WEB_PORTAL_LEGACY_ADMIN_URL`
- คู่มืออธิบายตัวแปร env ทั้งระบบ: [`docs/ENV_REFERENCE_TH.md`](../../docs/ENV_REFERENCE_TH.md)

---

## 1) ความสามารถหลัก

- ล็อกอินด้วย Discord OAuth
- หน้า `/player` สำหรับผู้เล่น:
  - Login with Discord + หน้าโปรไฟล์ผู้เล่น (avatar/ชื่อ/สถานะบัญชี)
  - ผูก SteamID (ผูกได้ครั้งเดียว) + ตรวจสอบรูปแบบ + ประวัติ bind ล่าสุด
  - ชื่อในเกมดึงอัตโนมัติจาก SCUM log (ไม่ต้องกรอกเอง)
  - Dashboard ผู้เล่น (coin, VIP, mission summary, latest order, rent status, announcements)
  - Wallet + ธุรกรรมย้อนหลัง (รายรับ/รายจ่าย/redeem/purchase)
  - Shop + ค้นหา + buy now + cart + checkout
  - Order history + สถานะส่งของ
  - Redeem + ประวัติโค้ดที่ใช้แล้ว
  - Vehicle rental + สถานะปัจจุบัน + ประวัติการเช่า
  - ปาร์ตี้ + แชทกลุ่ม (อิงจาก `stats.squad` ในระบบ)
  - Daily/Weekly missions + ปุ่มรับรางวัลจากหน้าเว็บ
  - วงล้อสุ่มรางวัล (Lucky Wheel) + คูลดาวน์ + ประวัติการหมุน + รองรับรางวัลไอเทมพร้อมไอคอน
  - แสดงกฎเซิร์ฟเวอร์ + คำแนะนำผู้เล่นจาก config
  - แท็บแผนที่ (ฝัง SCUM map ในหน้าเว็บ + ปุ่มเปิดแท็บใหม่)
  - Leaderboard + Bounty
  - Notification center
- API ผู้เล่นของเว็บนี้เรียก service/store ตรง:
  - `/player/api/me`
  - `/player/api/profile`
  - `/player/api/server/info`
  - `/player/api/prices`
  - `/player/api/stats/me`
  - `/player/api/leaderboard`
  - `/player/api/wallet/ledger`
  - `/player/api/redeem/history`
  - `/player/api/rentbike/status`
  - `/player/api/party`
  - `/player/api/party/chat`
  - `/player/api/party/chat/send`
  - `/player/api/missions`
  - `/player/api/wheel/state`
  - `/player/api/wheel/spin`
  - `/player/api/notifications`
  - `/player/api/linksteam/me|history|set|unset`
  - `/player/api/daily/claim`
  - `/player/api/weekly/claim`
  - `/player/api/gift`
  - `/player/api/dashboard`
  - `/player/api/shop/list`
  - `/player/api/shop/buy` (`/player/api/buy`)
  - `/player/api/purchase/list`
  - `/player/api/cart`
  - `/player/api/cart/add|remove|clear|checkout`
  - `/player/api/bounty/list`
  - `/player/api/redeem`
  - `/player/api/rentbike/request`
  - `/player/api/bounty/add`

---

## 2) เงื่อนไขก่อนเริ่ม

1. Node.js 20+
2. ติดตั้ง dependencies โครงการหลักแล้ว (`npm install` ที่ root)
3. ตั้งค่า Discord OAuth app

> หมายเหตุ: เว็บนี้ใช้งานได้แม้ `BOT_ENABLE_ADMIN_WEB=false`

ติดตั้งแบบง่ายจาก root project:

```bash
npm run setup:easy
```

---

## 3) ตั้งค่า Discord OAuth

ที่ Discord Developer Portal -> OAuth2:

- Redirect URI (local):
  - `http://127.0.0.1:3300/auth/discord/callback`
- Redirect URI (production):
  - `https://player.genz.noah-dns.online/auth/discord/callback`

นำค่าเหล่านี้มาใส่ `.env` ของเว็บ:

- `WEB_PORTAL_DISCORD_CLIENT_ID`
- `WEB_PORTAL_DISCORD_CLIENT_SECRET`

---

## 4) ตั้งค่า .env ของเว็บ

สร้างไฟล์:

```bash
copy apps\web-portal-standalone\.env.example apps\web-portal-standalone\.env
```

ค่าที่ต้องตั้งอย่างน้อย:

- `WEB_PORTAL_MODE=player`
- `WEB_PORTAL_BASE_URL=http://127.0.0.1:3300`
- `WEB_PORTAL_LEGACY_ADMIN_URL=http://127.0.0.1:3200/admin`
- `WEB_PORTAL_DISCORD_CLIENT_ID=...`
- `WEB_PORTAL_DISCORD_CLIENT_SECRET=...`

ค่าที่แนะนำเพิ่ม (Map):

- `WEB_PORTAL_MAP_EMBED_ENABLED=true`
- `WEB_PORTAL_MAP_EXTERNAL_URL=https://scum-map.com/th/map/bunkers_and_killboxes`
- `WEB_PORTAL_MAP_EMBED_URL=https://scum-map.com/th/map/bunkers_and_killboxes`

นโยบายผู้เล่น:

- เปิดกว้าง (ค่าแนะนำเริ่มต้น):
  - `WEB_PORTAL_PLAYER_OPEN_ACCESS=true`
- ถ้าต้องการล็อกเฉพาะคน:
  - `WEB_PORTAL_PLAYER_OPEN_ACCESS=false`
  - แล้วตั้ง `WEB_PORTAL_ALLOWED_DISCORD_IDS` หรือ `WEB_PORTAL_REQUIRE_GUILD_MEMBER=true`

### 4.1 Session / Cookies / Origin check (ตั้งค่าแบบละเอียด)

เว็บนี้จะสร้าง session ผู้เล่นผ่าน Discord OAuth แล้วเก็บไว้ใน cookie

ค่าสำคัญ (ค่า default ที่ระบบใช้):
- `WEB_PORTAL_SESSION_COOKIE_NAME` (default: `scum_portal_session`)
- `WEB_PORTAL_SESSION_COOKIE_PATH` (default: `/`)
- `WEB_PORTAL_COOKIE_DOMAIN` (default: ว่าง = ผูกกับ host ปัจจุบันเท่านั้น)
- `WEB_PORTAL_COOKIE_SAMESITE` (default: `Lax`)
- `WEB_PORTAL_SECURE_COOKIE`
  - ต้องเป็น `true` เมื่อเว็บถูก expose ผ่าน HTTPS (สำคัญมากสำหรับ browser)
- `WEB_PORTAL_ENFORCE_ORIGIN_CHECK` (default: `true`)
  - เปิดการป้องกัน CSRF: ถ้าคำขอ “ข้าม origin” ถูกมองว่าไม่ปลอดภัย ระบบจะปฏิเสธ

คำแนะนำ production:
- ตั้ง `WEB_PORTAL_SECURE_COOKIE=true`
- ตั้ง `WEB_PORTAL_COOKIE_SAMESITE=Lax` (ค่าเริ่มต้น) หรือใช้ `Strict` เฉพาะเมื่อมั่นใจว่า flow OAuth ไม่สะดุด
- ถ้าใช้หลาย subdomain และต้องการให้ cookie ใช้งานร่วมกันข้าม subdomain ให้ตั้ง `WEB_PORTAL_COOKIE_DOMAIN`
  - ตัวอย่าง: `player.example.com` (ปรับตามโดเมนจริง)

ตรวจสอบ/ทดสอบหลังตั้งค่า:
1. Login แล้วเข้า `/player` ได้
2. กดเมนูที่เรียก `POST` (เช่น daily/weekly claim, shop buy/checkout) แล้วไม่โดน 403 `Cross-site request denied`

---

## 5) พฤติกรรม Route

- `/` -> redirect ไป `/player`
- `/player` -> หน้า portal ผู้เล่น
- `/player/login` -> หน้า login
- `/admin`, `/admin/login`, `/admin/*` -> redirect ไป `WEB_PORTAL_LEGACY_ADMIN_URL`
- ไม่มีการเสิร์ฟ admin API ใน app นี้

---

## 6) รันใช้งาน

จาก root project:

```bash
npm run start:web-standalone
```

ตรวจสุขภาพ:

```bash
curl http://127.0.0.1:3300/healthz
```

ตรวจ env ก่อน deploy:

```bash
npm run doctor:web-standalone
npm run doctor:web-standalone:prod
npm run readiness:prod
```

---

## 7) Smoke Test ที่ควรผ่าน

1. Login Discord สำเร็จ -> เข้า `/player`
2. API ผู้เล่นตอบ 200:
   - `/player/api/me`
   - `/player/api/server/info`
   - `/player/api/dashboard`
   - `/player/api/shop/list`
   - `/player/api/cart`
   - `/player/api/purchase/list`
   - `/player/api/bounty/list`
3. ทดสอบ POST:
   - daily / weekly
   - wheel spin
   - gift
   - redeem
   - buy / cart checkout
   - rentbike request
   - bounty add
   - linksteam set / unset
4. ปิด admin web ฝั่งบอท (`BOT_ENABLE_ADMIN_WEB=false`) แล้ว portal ผู้เล่นยังใช้ได้ปกติ (ไม่มี 502 ใน `/player/api/*`)
5. เข้า `/admin` แล้ว redirect ไป URL admin เดิม

รันแบบอัตโนมัติหลัง deploy:

```bash
npm run smoke:postdeploy
```

ตั้งค่า base URL สำหรับ smoke script ได้:

```bash
set SMOKE_ADMIN_BASE_URL=https://admin.genz.noah-dns.online/admin
set SMOKE_PLAYER_BASE_URL=https://player.genz.noah-dns.online
npm run smoke:postdeploy
```

Windows helper (รัน readiness + smoke ต่อเนื่อง):

```bat
deploy\run-production-checks.cmd
```

หมายเหตุ SteamID:
- ผู้เล่นผูกได้ 1 ครั้งต่อบัญชี
- `/player/api/linksteam/unset` จะตอบ `403` เพื่อบังคับให้เปลี่ยนผ่านแอดมินเท่านั้น

หมายเหตุวงล้อ (อัตราออก + ไอเทม):
- ปรับอัตรารางวัลด้วย `weight` ใน `config.luckyWheel.rewards`
- รองรับรางวัลประเภท `item` พร้อม `itemId/gameItemId/quantity/iconUrl`
- หากมีรางวัล `item` อยู่ในวงล้อ ผู้เล่นต้องผูก SteamID ก่อนหมุน
- ตัวอย่าง:

```json
{
  "luckyWheel": {
    "enabled": true,
    "cooldownMs": 21600000,
    "rewards": [
      { "id": "coin-500", "label": "500 Coins", "type": "coins", "amount": 500, "weight": 40 },
      {
        "id": "ak47-drop",
        "label": "AK-47 x1",
        "type": "item",
        "itemId": "loot-box",
        "gameItemId": "AK47",
        "quantity": 1,
        "iconUrl": "https://vbothost.github.io/scum_items/AK47.webp",
        "weight": 10
      },
      { "id": "miss", "label": "พลาดรางวัล", "type": "none", "amount": 0, "weight": 50 }
    ]
  }
}
```

---

## 8) Deploy Production (ย่อ)

1. คัดลอกไฟล์ template production:
   - `copy apps\web-portal-standalone\.env.production.example apps\web-portal-standalone\.env`
2. ตั้งโดเมน + HTTPS
3. ตั้ง `WEB_PORTAL_BASE_URL=https://player.genz.noah-dns.online`
4. ตั้ง `WEB_PORTAL_LEGACY_ADMIN_URL=https://admin.genz.noah-dns.online/admin`
5. ตั้ง Discord OAuth ให้ตรง redirect จริง
6. รัน `npm run doctor:web-standalone:prod` ให้ PASS
7. รันด้วย process manager (PM2 / service manager)

---

## 9) ปัญหาที่เจอบ่อย

### Login แล้วเด้งกลับ login

- `WEB_PORTAL_DISCORD_CLIENT_SECRET` ผิด
- redirect URI ใน Discord ไม่ตรงกับ `WEB_PORTAL_DISCORD_REDIRECT_PATH`
- cookie ไม่ถูกส่ง (เช่นตั้งค่า secure/samesite ไม่ตรงสภาพแวดล้อม)

### กด `/admin` แล้วเข้าไม่ได้

- `WEB_PORTAL_LEGACY_ADMIN_URL` ชี้ผิด
- admin เดิมไม่ทำงานที่ปลายทางนั้น

### รันแล้วขึ้น `port ... is already in use`

- มี process อื่นใช้พอร์ตเดียวกันอยู่
- Windows (PowerShell):
  - `netstat -ano | findstr :3300`
  - `taskkill /PID <PID> /F`
- จากนั้นค่อยรัน `npm run start:web-standalone` ใหม่

### Doctor ไม่ผ่าน

- URL ไม่ถูกต้อง
- production ยังไม่เปิด `WEB_PORTAL_SECURE_COOKIE=true`
- production ใช้ `http://` แทน `https://`
