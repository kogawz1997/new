# สรุปสถานะโปรเจกต์ (SCUM Discord Bot)

วันที่เริ่มรีวิว: 5 มีนาคม 2026  
อัปเดตล่าสุด: 6 มีนาคม 2026

## ภาพรวม
โปรเจกต์อยู่ในสถานะ "ใช้งานจริงได้" และมีโครงสร้างระบบหลักครบทั้งฝั่ง Discord, SCUM webhook, แอดมินเว็บ, และงานส่งของอัตโนมัติผ่าน RCON queue

ระบบที่พร้อมใช้งานแล้ว:
- ระบบเศรษฐกิจ (wallet/daily/weekly/shop/purchase)
- ระบบทิคเก็ต + ปิดแล้วลบห้องอัตโนมัติ
- ระบบสถิติ/อันดับ (kills, kd, playtime, economy)
- SCUM log watcher + webhook เข้า Discord แบบเรียลไทม์
- Admin Web (มี login/session/rate limit)
- RCON Delivery Queue + retry + audit log
- ระบบเช่ารถ (rent bike) พร้อมโควต้ารายวัน/งานรีเซ็ต
- ระบบสินค้าแบบหลายไอเทมต่อ 1 รายการ (bundle)

---

## สิ่งที่ปรับปรุงเสร็จแล้ว

### 1) คุณภาพโค้ดและ CI
- เพิ่มการตรวจ syntax ทั้งโปรเจกต์ผ่าน `npm run lint`
- เพิ่มชุดทดสอบผ่าน `npm test` (`node:test`)
- เพิ่ม workflow CI ที่ `.github/workflows/ci.yml`
- มีคำสั่งรวมเช็กระบบสำหรับก่อนปล่อยงาน

### 2) การจัดการ Environment
- มีตัวตรวจ env กลางที่ `src/utils/env.js`
- บังคับ validate ค่า env สำคัญก่อนรัน bot/register/watcher

### 3) Data Layer และ Persistence
- ฝั่ง wallet/shop/purchase ใช้ Prisma + SQLite แล้ว
- ฝั่ง store บางโมดูลยังเป็น persistence แบบ key-value ผ่าน `_persist`
- มี fallback migration ข้อมูลเก่าจากไฟล์เดิมเข้า DB

### 4) Admin Web พร้อมใช้งานจริง
- แยกหน้า login/dashboard ชัดเจน
- session cookie + logout + `/admin/api/me`
- login rate-limit กัน brute force
- SSE live update + polling fallback
- มี Action Center/Config Editor/Danger Zone

### 5) ระบบร้านค้าและสินค้าหลายไอเทม (Bundle)
ทำเสร็จครบตั้งแต่ UI -> API -> DB -> Bot -> Delivery
- เพิ่มฟิลด์ `deliveryItemsJson` ใน `ShopItem`
- สินค้า 1 ชิ้นรองรับหลายไอเทมในเกม (`deliveryItems[]`)
- หน้าแอดมินเพิ่มสินค้าแบบเลือกหลายไอเทมจาก catalog พร้อมไอคอน
- ปรับจำนวนต่อไอเทมและลบรายการย่อยได้
- `/shop`, `/buy`, panel card และปุ่มซื้อจาก panel แสดงผล bundle แล้ว
- RCON queue รองรับส่งหลายคำสั่งตามรายการไอเทมใน bundle

### 6) ระบบส่งของอัตโนมัติ (RCON Queue)
- คิวทีละงาน (worker loop)
- retry + backoff + max retries
- เปลี่ยนสถานะคำสั่งซื้ออัตโนมัติ (`pending/delivering/delivered/failed`)
- บันทึก delivery audit แยก และส่ง live update เข้าแอดมินเว็บ

### 7) SCUM Watcher ความเสถียร
- parse event ครอบคลุม join/leave/kill/restart
- dedupe event window
- queue + retry + dead-letter file
- รองรับ log rotate/reset

---

## งานจากรอบรีวิวที่ปิดแล้ว

### A) ปรับข้อความ legacy ที่ยัง mojibake
สถานะ: เสร็จแล้ว  
- แก้ข้อความเพี้ยนจาก encoding เก่าในไฟล์หลัก
- เพิ่ม guard ตรวจ mojibake ใน `npm run lint` เพื่อกันกลับมาอีก

### B) เพิ่ม test ระดับ integration
สถานะ: เสร็จแล้ว  
- เพิ่ม test flow ซื้อสินค้า -> เข้า queue -> ส่งของสำเร็จ
- เพิ่ม test admin API สำคัญ (auth + validation)
- เพิ่ม test watcher parse ด้วย sample log หลายรูปแบบ

### C) ปรับมาตรฐานคำสั่ง RCON สำหรับ bundle
สถานะ: เสร็จแล้ว  
- บังคับ template สำหรับ bundle ต้องมี `{gameItemId}` หรือ `{quantity}`
- ถ้าไม่ผ่านเงื่อนไขจะ reject ตั้งแต่ enqueue เพื่อลดความเสี่ยงส่งของผิด

### D) observability production
สถานะ: เสร็จแล้ว  
- เพิ่ม metrics/alerts ครอบคลุม:
  - queue length
  - delivery fail rate
  - webhook error rate
  - admin login failure spikes
- เพิ่ม endpoint สรุป metrics สำหรับแอดมิน

### E) QA hardening รอบล่าสุด (6 มีนาคม 2026)
สถานะ: เสร็จแล้ว  
- เพิ่ม integration test ใหม่สำหรับ SCUM webhook server:
  - ตรวจ path/auth/guild validation
  - ตรวจ dispatch event (`status`, `kill`) ไป service ถูกต้อง
- เพิ่ม test ใหม่สำหรับ item icon resolver:
  - โหลดจาก `index.json`
  - fallback ไป scan directory เมื่อไม่มี index
  - รองรับ alias แบบ blueprint ที่ลงท้าย `_C` (เช่น `BP_WEAPON_AK47_C`)
- ปรับ `startScumServer()` ให้คืนค่า `server` เพื่อปิดพอร์ตใน test และรองรับ automation test ได้เสถียรขึ้น
- สถานะทดสอบล่าสุด:
  - `npm run check` ผ่าน
  - `npm run doctor` ผ่าน
  - `npm test` ผ่าน 13/13

หมายเหตุสำคัญ: คำว่า "ทดสอบ 100%" ในงานระบบจริงหมายถึง "ครอบคลุมตามชุดทดสอบที่นิยามไว้" ไม่สามารถการันตี 100% ทุกเหตุการณ์ production ได้ แต่รอบนี้ปิดช่องทดสอบเชิง integration เพิ่มในจุดเสี่ยงหลักแล้ว

### F) Security hardening สำหรับ production
สถานะ: เสร็จแล้ว (baseline hardening)  
- Admin Web:
  - เพิ่ม security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, ฯลฯ)
  - เพิ่ม origin/`sec-fetch-site` protection สำหรับคำขอที่ใช้ session (ลดความเสี่ยง CSRF)
  - ปิด token ผ่าน query string โดยค่าเริ่มต้น (`ADMIN_WEB_ALLOW_TOKEN_QUERY=false`)
  - เพิ่ม body-size guard สำหรับ API (`ADMIN_WEB_MAX_BODY_BYTES`)
  - ปรับ `x-forwarded-for` ให้ใช้ได้เฉพาะตอนตั้ง `ADMIN_WEB_TRUST_PROXY=true` เพื่อลด spoof IP
- SCUM Webhook:
  - บังคับ `Content-Type: application/json`
  - เพิ่ม request body limit + timeout
  - ตรวจ event type ให้เป็น whitelist เท่านั้น
  - เทียบ secret แบบ timing-safe
  - แจ้งเตือนเมื่อไม่ได้ตั้ง `SCUM_WEBHOOK_SECRET`
- เพิ่ม integration tests ด้าน security:
  - cross-site POST (cookie session) ต้องโดน block 403
  - webhook invalid content-type / invalid event type ต้อง reject
  - header token ยังใช้ได้, query token ถูกปิดตามค่าเริ่มต้น

สิ่งที่ “ยังต้องทำ” ถ้าจะยกระดับอีกขั้น:
1. แยก RBAC role-based permissions ใน admin API (owner/admin/mod)
2. เพิ่ม 2FA หรือ SSO หน้าแอดมิน
3. วาง reverse proxy + WAF + fail2ban ที่ชั้น network
4. เพิ่ม external secret manager + key rotation automation

## งานที่ควรทำต่อรอบถัดไป

1. RBAC ใน admin web (owner/admin/moderator)
2. ระบบ backup/restore จากหน้า admin
3. เพิ่ม e2e test สำหรับ SSE/live update และ flow ticket ที่ครบวงจร
4. แยก observability ไป dashboard เฉพาะ (trend graph รายวัน)

## นโยบายอัปเดตรายละเอียดทุกครั้งที่อัปเดตระบบ

- บันทึกทุกรอบอัปเดตในไฟล์ [SYSTEM_UPDATES.md](/c:/new/docs/SYSTEM_UPDATES.md)
- ทุกครั้งก่อน deploy ให้รัน `npm run lint` และ `npm test`
- ถ้ามีการเปลี่ยนพฤติกรรมระบบ ให้เพิ่มหัวข้อผลกระทบและ rollback note ใน log รอบนั้น

---

## สถานะพร้อมใช้งาน (Operational Readiness)

พร้อมใช้งานทันที:
- รันบอท: `npm start`
- รันวอทเชอร์: `node scum-log-watcher.js`
- แอดมินเว็บ: เปิดผ่านเส้นทาง `/admin/login`

ก่อนรันใน production แนะนำทำเพิ่ม:
1. ตรวจ env ครบทุกตัวที่เกี่ยวกับ Discord/RCON/Admin Web
2. ยืนยัน `delivery.auto.itemCommands` สำหรับสินค้าที่ต้องส่งอัตโนมัติ
3. รัน lint/test ทุกครั้งก่อน deploy
4. ทำ backup DB ตามรอบเวลา

---

## สรุป
โปรเจกต์ตอนนี้ผ่านช่วง prototype และอยู่ในระดับ "ระบบจริงที่ดูแลต่อได้" แล้ว
โดยจุดที่ยกระดับชัดที่สุดในรอบนี้คือ:
- Admin Web ที่ใช้งานได้จริง
- ระบบส่งของอัตโนมัติที่มี queue/retry/audit
- ระบบสินค้าแบบหลายไอเทมต่อรายการครบทั้งเส้นทาง

งานลำดับถัดไปควรเน้น RBAC ฝั่งแอดมิน, backup/restore ที่ใช้งานจริง, และแดชบอร์ด observability เชิงแนวโน้ม
