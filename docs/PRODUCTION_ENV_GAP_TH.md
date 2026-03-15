# รายงานเทียบ `.env` ปัจจุบันกับ production baseline

เอกสารนี้สรุปสถานะไฟล์ env ที่ใช้งานจริงในเครื่องปัจจุบัน เทียบกับ baseline สำหรับ production rollout

อัปเดตล่าสุด: **2026-03-15**

ไฟล์ที่ตรวจ
- root runtime: [../.env](../.env)
- root baseline: [../.env.production.example](../.env.production.example)
- portal runtime: [../apps/web-portal-standalone/.env](../apps/web-portal-standalone/.env)
- portal baseline: [../apps/web-portal-standalone/.env.production.example](../apps/web-portal-standalone/.env.production.example)

หมายเหตุ
- เอกสารนี้ไม่แสดงค่า secret จริง
- สถานะจะสรุปเป็น `ตั้งแล้ว`, `ตั้งแล้วโดยตั้งใจ`, `ควรหมุนตาม policy`, หรือ `ต้องยืนยันหน้างาน`

---

## 1. สรุปภาพรวม

### Production baseline ที่ปิดแล้ว
- `NODE_ENV=production`
- `PERSIST_REQUIRE_DB=true`
- `PERSIST_LEGACY_SNAPSHOTS=false`
- `DATABASE_URL` ใช้ production sqlite path แล้ว
- split-origin ใช้งานจริงแล้ว
  - admin: `https://admin.genz.noah-dns.online/admin`
  - player: `https://player.genz.noah-dns.online`
- admin cookie แยก path/domain ชัดเจน
- player cookie แยก domain ชัดเจน
- `ADMIN_WEB_2FA_ENABLED=true`
- `ADMIN_WEB_2FA_SECRET` ตั้งแล้ว
- `ADMIN_WEB_SSO_DISCORD_ENABLED=true`
- admin Discord OAuth redirect ตั้งแล้ว
- player Discord OAuth redirect ตั้งแล้ว
- portal อนุญาตให้ fallback ไปใช้ root Discord secret ได้
- PM2 runtime `bot / worker / watcher / web / console-agent` ออนไลน์ครบ

### สิ่งที่ผ่านการยืนยันแล้ว
- `npm run doctor`
- `npm run security:check`
- `npm run readiness:prod`
- `npm run smoke:postdeploy`

### ช่องว่างที่ไม่ใช่บั๊ก env แล้ว
- ต้องยืนยัน DNS / reverse proxy / TLS ของโดเมนจริงในหน้างาน
- ต้องยืนยัน redirect URIs ใน Discord Developer Portal ให้ตรงกับโดเมนจริง
- ควรมี secret rotation policy ต่อเนื่อง
- ควรทดสอบ live delivery บนเครื่องที่มี Windows session + SCUM client จริงหลัง deploy ทุกครั้ง

---

## 2. สถานะแยกตามกลุ่มสำคัญ

### 2.1 Core runtime
- `DISCORD_TOKEN`: ตั้งแล้ว, ควรหมุนตาม policy
- `DISCORD_CLIENT_ID`: ตั้งแล้ว
- `DISCORD_GUILD_ID`: ตั้งแล้ว
- `DATABASE_URL`: ตั้งแล้ว
- `NODE_ENV`: ตั้งแล้ว

### 2.2 Admin web hardening
- `ADMIN_WEB_ALLOWED_ORIGINS`: ตั้งแล้ว
- `ADMIN_WEB_SECURE_COOKIE`: ตั้งแล้ว
- `ADMIN_WEB_HSTS_ENABLED`: ตั้งแล้ว
- `ADMIN_WEB_ENFORCE_ORIGIN_CHECK`: ตั้งแล้ว
- `ADMIN_WEB_ALLOW_TOKEN_QUERY=false`: ตั้งแล้ว
- `ADMIN_WEB_SESSION_COOKIE_PATH=/admin`: ตั้งแล้ว
- `ADMIN_WEB_SESSION_COOKIE_DOMAIN=admin.genz.noah-dns.online`: ตั้งแล้ว
- `ADMIN_WEB_2FA_ENABLED=true`: ตั้งแล้ว
- `ADMIN_WEB_2FA_SECRET`: ตั้งแล้ว
- `ADMIN_WEB_PASSWORD`: ตั้งแล้ว, ควรหมุนตาม policy
- `ADMIN_WEB_TOKEN`: ตั้งแล้ว, ควรหมุนตาม policy

### 2.3 Admin Discord SSO
- `ADMIN_WEB_SSO_DISCORD_ENABLED=true`: ตั้งแล้ว
- `ADMIN_WEB_SSO_DISCORD_CLIENT_ID`: ตั้งแล้ว
- `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET`: ตั้งแล้ว
- `ADMIN_WEB_SSO_DISCORD_REDIRECT_URI`: ตั้งแล้ว
- `ADMIN_WEB_SSO_DISCORD_GUILD_ID`: ตั้งแล้ว
- `ADMIN_WEB_SSO_DEFAULT_ROLE`: ตั้งแล้ว

ผลที่ยืนยันแล้ว
- `/admin/auth/discord/start` redirect ไป Discord ได้จริงใน smoke test
- admin SSO ใช้งานร่วมกับ split-origin และ 2FA baseline ได้

ข้อแนะนำเพิ่ม
- ถ้าต้องการ map สิทธิ์ละเอียดตาม role จริง ควรตั้ง
  - `ADMIN_WEB_SSO_DISCORD_OWNER_ROLE_IDS`
  - `ADMIN_WEB_SSO_DISCORD_ADMIN_ROLE_IDS`
  - `ADMIN_WEB_SSO_DISCORD_MOD_ROLE_IDS`

### 2.4 Player portal OAuth
- `WEB_PORTAL_BASE_URL`: ตั้งแล้ว
- `WEB_PORTAL_LEGACY_ADMIN_URL`: ตั้งแล้ว
- `WEB_PORTAL_DISCORD_CLIENT_ID`: ตั้งแล้ว
- `WEB_PORTAL_DISCORD_REDIRECT_PATH=/auth/discord/callback`: ตั้งแล้ว
- `WEB_PORTAL_DISCORD_CLIENT_SECRET`: ตั้งแล้วโดยตั้งใจให้ว่าง

หมายเหตุ
- portal fallback ไปใช้ `ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET`
- tooling ปัจจุบันรองรับ pattern นี้ และผ่านทั้ง `security:check`, `readiness:prod`, `smoke:postdeploy`

### 2.5 Delivery / watcher / agent runtime
- `SCUM_LOG_PATH`: ตั้งแล้ว
- `SCUM_WEBHOOK_SECRET`: ตั้งแล้ว, ควรหมุนตาม policy
- `SCUM_CONSOLE_AGENT_TOKEN`: ตั้งแล้ว, ควรหมุนตาม policy
- `RCON_PASSWORD`: ตั้งแล้ว, ควรหมุนตาม policy
- `DELIVERY_EXECUTION_MODE=agent`: ตั้งแล้ว
- health ports ของ `bot / worker / watcher / agent`: ตั้งแล้ว

### 2.6 Persistence / topology
- `PERSIST_REQUIRE_DB=true`: ตั้งแล้ว
- `PERSIST_LEGACY_SNAPSHOTS=false`: ตั้งแล้ว
- topology แยก `bot` กับ `worker` สำหรับ delivery แล้ว
- `doctor:topology:prod` ผ่าน

---

## 3. สรุป gap จริงที่เหลือ

ไม่มี blocker ระดับ env/validation ภายใน repo แล้วสำหรับ production baseline ชุดนี้

สิ่งที่ยังเหลือเป็นงานหน้างานจริง:
- ชี้ DNS ให้ `admin.genz.noah-dns.online` และ `player.genz.noah-dns.online`
- ใช้ reverse proxy/TLS ตาม [deploy/nginx.player-admin.example.conf](../deploy/nginx.player-admin.example.conf)
- ลง redirect URIs ใน Discord Developer Portal ให้ตรง
- หมุน secret ตามรอบงานจริงและเก็บใน secret manager ถ้ามี
- ทดสอบ live delivery หลัง deploy บนเครื่อง SCUM จริง

---

## 4. คำสั่งตรวจหลังเปลี่ยน env

```bat
npm run doctor
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

ผลอ้างอิงล่าสุด
- `doctor`: ผ่าน
- `security:check`: ผ่าน
- `readiness:prod`: ผ่าน
- `smoke:postdeploy`: ผ่าน

---

## 5. ข้อเสนอแนะถัดไป

1. ตั้ง Discord role mapping ให้ owner/admin/mod ชัดขึ้นถ้าจะใช้ SSO เป็นช่องทางหลักของทีมงาน
2. ตั้ง reverse proxy monitoring และ external uptime checks เพิ่มจาก health endpoint ภายใน
3. เพิ่มรอบหมุน secret แบบ scheduled และบันทึกวันที่หมุนล่าสุด
4. รัน live capability test หลังทุก deploy ที่กระทบ delivery/runtime
