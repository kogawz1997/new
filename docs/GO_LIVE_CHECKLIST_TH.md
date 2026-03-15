# Production Go-Live Checklist

เอกสารนี้ใช้เป็น checklist สั้น ๆ ก่อนเปิดใช้งานจริง โดยเน้น 3 เรื่อง: `hardening`, `runtime proof`, และ `delivery live validation`

อัปเดตล่าสุด: **2026-03-15**

---

## 1. Security / Auth Hardening

- ใช้ `NODE_ENV=production`
- ใช้ `ADMIN_WEB_SECURE_COOKIE=true`
- ใช้ `ADMIN_WEB_HSTS_ENABLED=true`
- ใช้ `ADMIN_WEB_TRUST_PROXY=true`
- ใช้ `ADMIN_WEB_ENFORCE_ORIGIN_CHECK=true`
- ตั้ง `ADMIN_WEB_ALLOWED_ORIGINS` เป็น `https://...` เท่านั้น
- เปิด `ADMIN_WEB_2FA_ENABLED=true` และใส่ `ADMIN_WEB_2FA_SECRET`
- หมุน `ADMIN_WEB_PASSWORD`, `ADMIN_WEB_TOKEN`, `SCUM_WEBHOOK_SECRET`, `SCUM_CONSOLE_AGENT_TOKEN`, Discord OAuth secret ให้เป็นค่าจริง
- แยก `admin` และ `player` คนละ origin/subdomain ถ้าเป็นไปได้

---

## 2. Runtime Topology

runtime ที่ควรแยกจริง:

- `bot`
- `worker`
- `watcher`
- `admin web`
- `player portal`
- `console-agent` ถ้าใช้ `agent mode`

ก่อนขึ้นจริงให้ยืนยันว่า:

- ไม่มี service overlap ระหว่าง `bot` กับ `worker`
- health endpoint ของทุก process ตอบได้
- PM2 หรือ process manager ตั้ง autorestart แล้ว
- มี external monitor เช็ก health เป็นระยะ ไม่พึ่ง dashboard อย่างเดียว

---

## 3. Database / Persistence

- ใช้ `PERSIST_REQUIRE_DB=true`
- ใช้ `PERSIST_LEGACY_SNAPSHOTS=false`
- รัน migration / generate ให้ครบ
- ทดสอบ backup และ restore แบบ dry-run ก่อนเสมอ
- ยืนยันว่ามี rollback backup สำหรับ restore ล่าสุด

---

## 4. Commands / Delivery Validation

### ก่อนเปิดรับ order จริง

1. รัน `delivery preflight`
2. รัน `delivery simulator`
3. รัน `capability test`
4. ยิง `test send` ด้วย item ที่รู้ผลลัพธ์แน่ชัด
5. เปิดดู timeline และ verify ว่า step log ปิดงานครบ

### ชุดคำสั่งขั้นต่ำที่ควรทดสอบ

- `announce`
- `teleport`
- `spawn`
- `multi-item`
- `magazine StackCount`

---

## 5. Agent Mode Live Proof

ถ้าใช้ `agent mode` ต้องยืนยันเพิ่ม:

- SCUM admin client เปิดค้างอยู่จริง
- บัญชีแอดมินอยู่ในเซิร์ฟเวอร์
- Windows session ไม่ lock
- console-agent online
- capability test ผ่านบนเครื่อง production จริง

หมายเหตุ:

- repo และ test ช่วยยืนยัน logic และ command execution path ได้
- แต่ live proof ยังต้องอาศัย runtime ภายนอกจริง เช่น SCUM client และ Windows session

---

## 6. Commands ที่ควรรันก่อนเปิดจริง

```bash
npm run doctor
npm run doctor:topology:prod
npm run doctor:web-standalone:prod
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

ถ้าใช้ admin/player ผ่าน public URL จริง ให้ตั้ง:

```bash
set SMOKE_ADMIN_BASE_URL=https://admin.genz.noah-dns.online/admin
set SMOKE_PLAYER_BASE_URL=https://player.genz.noah-dns.online
npm run smoke:postdeploy
```

---

## 7. หลังเปิดจริง 24 ชั่วโมงแรก

- ดู notification center ว่ามี dead-letter, backlog หรือ watcher silence หรือไม่
- ดู runtime supervisor ว่ามี process ไหน degraded/offline หรือไม่
- ตรวจ order จริง 2-3 รายการว่า timeline และ audit ครบ
- ตรวจ backup ล่าสุดและ restore status อีกครั้ง
