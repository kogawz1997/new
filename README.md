SCUM TH Bot - Project HQ
Node.js discord.js Prisma Tests Security

เอกสารนี้คือศูนย์กลางข้อมูลของโปรเจกต์ (Single Source of Truth) ใช้แทน PROJECT_REVIEW.md และ docs/SYSTEM_UPDATES.md

อัปเดตล่าสุด: 2026-03-07
สถานะระบบ: พร้อมใช้งานจริง (พร้อม checklist production)
ไฟล์อ้างอิงหลัก: README.md, src/*, test/*
สารบัญ
1) ภาพรวมระบบ
2) สถานะความพร้อมใช้งานจริง
3) สิ่งที่ทำเสร็จแล้ว (สรุปแบบระบบ)
4) ความปลอดภัย (Security Baseline)
5) ผลทดสอบล่าสุด
6) Runbook สำหรับใช้งานจริง
7) งานค้าง/แผนต่อไป
8) Changelog รวม
9) แผนผังไฟล์สำคัญ
10) กติกาการอัปเดตเอกสาร
1) ภาพรวมระบบ
โปรเจกต์นี้เป็นระบบจัดการเซิร์ฟเวอร์ SCUM ผ่าน Discord Bot + Admin Web โดยมีแกนหลักดังนี้:

Discord Bot (src/bot.js)
SCUM Log Watcher (scum-log-watcher.js)
Webhook Bridge (src/scumWebhookServer.js)
Admin API + Dashboard (src/adminWebServer.js, src/admin/*)
Data Layer (Prisma + SQLite/fallback persistence)
RCON Delivery Queue + Retry + Audit
flowchart LR
  A[SCUM.log] --> B[Watcher]
  B --> C[Webhook /scum-event]
  C --> D[Discord Bot Services]
  D --> E[Discord Channels]
  D --> F[(SQLite/Persist)]
  G[Admin Dashboard] --> H[Admin API]
  H --> F
  H --> D
2) สถานะความพร้อมใช้งานจริง
หมวด	สถานะ	หมายเหตุ
Economy / Shop / Purchase	พร้อม	รองรับสินค้าปกติ + bundle หลายไอเทม
RCON Auto Delivery	พร้อม	queue + retry + audit + observability
Rent Bike Daily	พร้อม	1 ครั้ง/วัน, queue ป้องกันชนกัน, reset รายวัน
Tickets / Events / Bounty	พร้อม	ปิด ticket แล้วลบห้องอัตโนมัติ
Stats / Kill Feed / Leaderboards	พร้อม	รองรับ kill weapon + distance + hit zone
Admin Web	พร้อม	login session, rate limit, live updates
SCUM Watcher/Webhook	พร้อม	dedupe + retry + dead-letter
Security Hardening	พร้อม baseline	มี checklist production ชัดเจน
CI / Lint / Test	พร้อม	check, test, security-check ผ่าน
3) สิ่งที่ทำเสร็จแล้ว (สรุปแบบระบบ)
3.1 Core Bot Features

ระบบเศรษฐกิจครบ: wallet, daily, weekly, transfer/gift
ระบบร้านค้า: buy/inventory, purchase log, refund, mark-delivered
ระบบตะกร้าสินค้าใช้งานได้จริง (/cart add|view|remove|clear|checkout)
ระบบสินค้าแบบ bundle: เพิ่มหลายไอเทมในสินค้าเดียว
ระบบ Ticket, Event, Bounty, VIP, Redeem
ระบบ panel command สำหรับโพสต์การ์ด/ปุ่มใช้งาน
3.2 Auto Delivery + RCON

เพิ่ม queue จัดส่งของอัตโนมัติ
รองรับ retry/backoff เมื่อส่งคำสั่งพลาด
มี audit log สำหรับตรวจย้อนหลัง
มี dead-letter queue พร้อม retry/remove เฉพาะรายการ
มี idempotency guard กัน enqueue/ส่งซ้ำ
มี watchdog แจ้งเตือน queue ค้างเกิน SLA
บังคับมาตรฐาน bundle template:
สินค้าแบบหลายไอเทมต้องมี {gameItemId} หรือ {quantity}
ถ้าไม่ผ่านจะ reject ตั้งแต่ enqueue
3.3 SCUM Integration

watcher parse log ได้หลายรูปแบบ (join/leave/kill/restart)
kill event รองรับข้อมูลอาวุธ ระยะ และจุดยิง (hit zone)
dedupe event กัน spam ซ้ำ
webhook timeout + retry + dead-letter
3.4 Rent Motorbike (Daily)

จำกัดเช่า 1 ครั้ง/วัน/คน
ทำงานบน queue ทีละคำสั่ง ลดปัญหาแยก vehicle id ผิด
เก็บสถานะ rental vehicle สำหรับ cleanup
มีงาน reset รอบวันตาม timezone ที่กำหนด
3.5 Admin Web (ปรับ UX แล้ว)

มีหน้า login แยกจาก dashboard
หน้า dashboard แยกหมวดชัดเจน ใช้งานง่ายขึ้น
รองรับธีม SCUM style (เช่น Tactical / Neon)
แสดงสถานะกดปุ่มชัดขึ้น และมี feedback runtime
มี Danger Zone แยก action เสี่ยง
รองรับ RBAC แบบ owner/admin/mod แยกสิทธิ์ตาม endpoint
รองรับ 2FA (TOTP) และ Discord SSO (เปิดใช้ผ่าน env)
รองรับ backup/restore snapshot ผ่าน Admin API (owner only)
3.6 Observability + Metrics

มี time-series metrics ใน dashboard:
delivery queue length
delivery fail rate
admin login failures
webhook error rate
มี metrics filter ตามช่วงเวลา (window) ในหน้า dashboard
มี alert event สำหรับ queue pressure / fail-rate spike / login-failure spike
route alert ไป Discord ช่องแอดมินอัตโนมัติ (ops-alert)
มี health endpoint สำหรับ monitor ภายนอก (GET /healthz)
3.7 Item Icons + Mapping

รองรับ mapping ชื่อไอเทมกับ icon
รองรับ fallback เมื่อไม่เจอ icon ตรงชื่อ
รองรับ normalize alias สำหรับอาวุธ/ไอเทม
ใช้ได้กับ feed/card ที่เกี่ยวข้อง
4) ความปลอดภัย (Security Baseline)
4.1 สิ่งที่ทำแล้ว

Admin API
session auth + token fallback
security headers (CSP / frame / referrer / MIME)
origin check + sec-fetch-site guard
body size limit
token compare แบบ timing-safe
Webhook
บังคับ JSON content-type
payload size limit
timeout + retry
secret verify แบบ timing-safe
event type whitelist
Operational
เพิ่ม npm run security:check
ลดความเสี่ยงจาก token query โดยปิด default
4.2 ค่า env ที่ควรมีใน production

SCUM_WEBHOOK_SECRET=<strong-random-secret>
SCUM_WEBHOOK_MAX_BODY_BYTES=65536
SCUM_WEBHOOK_REQUEST_TIMEOUT_MS=10000

ADMIN_WEB_PASSWORD=<strong-random-password>
ADMIN_WEB_TOKEN=<strong-random-token>
ADMIN_WEB_ALLOW_TOKEN_QUERY=false
ADMIN_WEB_ENFORCE_ORIGIN_CHECK=true
ADMIN_WEB_MAX_BODY_BYTES=1048576
ADMIN_WEB_TRUST_PROXY=true
ADMIN_WEB_SECURE_COOKIE=true
ADMIN_WEB_HSTS_ENABLED=true
ADMIN_WEB_HSTS_MAX_AGE_SEC=31536000
ADMIN_WEB_ALLOWED_ORIGINS=https://admin.your-domain.com
4.3 หมายเหตุความปลอดภัย

ไม่มีระบบใด "กันแฮกได้ 100%" แต่ baseline ปัจจุบันลดความเสี่ยงหลักได้มาก (CSRF, brute-force pressure, payload abuse, weak auth config)

5) ผลทดสอบล่าสุด
วันที่ยืนยันผล: 2026-03-07

คำสั่งที่รันจริง

npm run check
npm run security:check
ผลลัพธ์

npm run check ผ่าน
lint ผ่าน
test ผ่าน 21/21
npm run security:check ผ่าน (SECURITY_CHECK: PASSED)
Integration tests ที่มีแล้ว

purchase -> queue -> auto-delivery success
bundle template validation (placeholder guard)
admin API auth + validation
admin RBAC (owner/mod permission matrix)
admin live update stream + ticket claim/close full flow (e2e)
watcher parse หลายรูปแบบ (join/leave/kill/restart)
webhook auth/dispatch flow
item icon resolver + fallback
6) Runbook สำหรับใช้งานจริง
6.1 ติดตั้งและเริ่มระบบ

npm install
npm start
node scum-log-watcher.js
6.2 ลงทะเบียน slash commands

npm run register-commands
6.3 ก่อน deploy ทุกครั้ง

 หมุน secret ที่สำคัญ (admin/webhook/rcon)
 ตรวจ .env ครบและปลอดภัย
 รัน npm run check
 รัน npm run security:check
 รัน npm audit --omit=dev
 สำรองข้อมูลก่อนปล่อยจริง
6.4 Endpoint สำคัญ

Admin Web: http://127.0.0.1:3200/admin/login
Observability API: GET /admin/api/observability
SCUM Webhook: POST /scum-event
7) งานค้าง/แผนต่อไป
สถานะชุดงานใหญ่รอบก่อน (5 รายการ):

RBAC ละเอียดขึ้น (owner/admin/mod) - เสร็จแล้ว
backup/restore ผ่าน admin web - เสร็จแล้ว
e2e tests สำหรับ live update และ ticket full flow - เสร็จแล้ว
metrics dashboard แบบ time-series - เสร็จแล้ว
2FA/SSO สำหรับ admin login - เสร็จแล้ว
Roadmap รอบถัดไป (แผนหลัก):

P0 - ความปลอดภัยก่อนขึ้นจริง (เร่งด่วน)
หมุน secret ทั้งชุด (DISCORD_TOKEN, webhook/admin token, session secret, RCON)
เพิ่ม startup guard: ถ้าใช้ค่า default/เสี่ยง ให้บอทไม่ยอม start ใน production
เพิ่ม runbook incident response (token leak, webhook abuse, admin brute-force) สถานะล่าสุด:
เสร็จแล้ว: startup guard + incident response runbook + script สร้าง secrets
เสร็จแล้วเพิ่ม: หมุนค่า SCUM_WEBHOOK_SECRET, ADMIN_WEB_PASSWORD, ADMIN_WEB_TOKEN, RCON_PASSWORD ในไฟล์ env
เหลือทำ: หมุน DISCORD_TOKEN จาก Discord Developer Portal แล้วอัปเดตลง production env
P0 - ความเสถียรระบบส่งของ
เพิ่ม idempotency guard ระดับ worker กัน enqueue ซ้ำ/ส่งซ้ำ
เพิ่มคำสั่ง retry dead-letter จาก admin web แบบเลือกเฉพาะรายการ
เพิ่ม watchdog แจ้งเตือน queue ค้างเกิน SLA สถานะล่าสุด:
เสร็จแล้ว: idempotency guard + dead-letter retry/remove + queue watchdog
P1 - ขยายการทดสอบ E2E
เพิ่ม e2e สำหรับ flow Discord interaction ครบ (slash/button/modal)
เพิ่ม e2e rent bike (เช่า -> ส่งรถ -> รีเซ็ตเที่ยงคืน -> cleanup)
เพิ่ม restore drill test (backup -> restore -> verify data integrity) สถานะล่าสุด:
เสร็จแล้วบางส่วน: restore drill ใน integration test (backup -> mutate -> restore -> verify)
เหลือทำ: e2e Discord interaction ครบชุด + e2e rent bike full flow
P1 - Observability ฝั่ง production
เพิ่ม retention/time-window/filter ใน metrics dashboard
เพิ่ม alert route ไป Discord ช่องแอดมินแบบกำหนด threshold ได้
เพิ่ม health endpoint สำหรับ uptime monitor ภายนอก สถานะล่าสุด:
เสร็จแล้ว: window/filter ใน /admin/api/observability + UI apply window
เสร็จแล้ว: alert route ไป Discord admin channel (ops-alert)
เสร็จแล้ว: health endpoint GET /healthz
P2 - Data Layer ระยะยาว
ย้าย store ที่ยังเป็น JSON ไป Prisma แบบค่อยเป็นค่อยไป
ทำ migration checklist ต่อระบบ (wallet/shop/ticket/stats) พร้อม rollback plan
ปิดโหมด fallback JSON เฉพาะ production หลังย้ายครบ
ลำดับเริ่มทำจริงรอบต่อไป:

ปิด P0 ความปลอดภัย
ปิด P0 ระบบส่งของ
ปิด P1 การทดสอบ E2E
ปิด P1 Observability
เดิน P2 Data Layer
8) Changelog รวม
2026-03-07

แก้ mojibake ใน src/commands/cart.js ทั้งไฟล์ให้เป็น UTF-8 ไทยล้วน
เพิ่มคำสั่ง /panel shop-refresh-buttons:
ใช้ลบปุ่ม Checkout แบบเก่าในโพสต์ร้านค้าเดิม (ย้อนหลังตาม limit)
ลดปัญหาปุ่มเก่ากดแล้วไม่ตรง flow ใหม่
อัปเดตหัวข้อ งานค้าง/แผนต่อไป เป็น roadmap แบบ P0/P1/P2 พร้อมลำดับทำงาน
เพิ่ม production startup guard ใน src/utils/env.js
ถ้า NODE_ENV=production และค่า security baseline ไม่ผ่าน ระบบจะไม่ยอม start
เพิ่ม script npm run security:generate-secrets สำหรับหมุน secret ได้เร็ว
เพิ่ม runbook docs/INCIDENT_RESPONSE.md สำหรับ token leak / webhook abuse / brute-force
ปิดงาน P0 ความเสถียรระบบส่งของ:
เพิ่ม dead-letter queue + retry/remove endpoint
เพิ่ม idempotency guard ป้องกันส่งซ้ำ
เพิ่ม watchdog alert สำหรับ queue ค้างเกิน SLA
หมุนค่า secret ใน env สำหรับ webhook/admin/rcon แล้ว (รอหมุน Discord token ทาง portal)
รีเฟรช slash commands แล้ว (npm run register-commands)
ยืนยันผลตรวจล่าสุด:
npm run lint ผ่าน
npm test ผ่าน (21/21)
npm run security:check ผ่าน
ปิดงาน P1 observability ฝั่ง production:
เพิ่ม query filter สำหรับ /admin/api/observability (windowMs, series)
เพิ่มปุ่ม apply window ให้ดึง metrics ตามช่วงเวลาจาก backend
เพิ่ม stream event ops-alert/delivery-dead-letter เข้า live update dashboard
เพิ่มส่ง ops-alert ไป Discord ช่องแอดมินจากตัวบอท
เพิ่ม health endpoint GET /healthz สำหรับ external monitor
เพิ่ม integration assertions สำหรับ backup/restore drill:
backup snapshot
mutate data
dry-run restore
live restore และตรวจความถูกต้องของข้อมูลหลัง restore
แก้ข้อความระบบ rent bike ที่เพี้ยน (mojibake) ให้เป็นข้อความปกติใช้งานจริง
2026-03-06

รวมเอกสารกระจัดกระจายเป็นไฟล์เดียว PROJECT_HQ.md
ปรับเอกสารให้เป็น UTF-8 ชัดเจน ไม่มีข้อความเพี้ยน
ยืนยันผลตรวจล่าสุด:
npm run check ผ่าน
npm run security:check ผ่าน
ตั้งกติกาอัปเดตเอกสารให้เขียนที่ไฟล์นี้ไฟล์เดียว
ปิดงานใหญ่ครบ 5 รายการ:
RBAC owner/admin/mod
backup/restore ผ่าน admin web
e2e tests live update + ticket full flow
metrics dashboard แบบ time-series
2FA/SSO สำหรับ admin login
Hardening รอบล่าสุด:
ปรับ scripts/security-check.js ให้ตรวจเข้มขึ้น
ตรวจว่า .env ไม่ถูก track โดย git
บังคับเงื่อนไขเพิ่มเมื่อ NODE_ENV=production
อัปเดต .gitignore ให้กันไฟล์ runtime (data/backups/, data/*.json, logs/)
ล้าง mojibake ในไฟล์ env และเพิ่ม guard ตรวจ encoding ครอบคลุมมากขึ้น
ปรับระบบตะกร้าให้ใช้งานจริง และตัดปุ่ม ชำระเงิน ออกจากการ์ดสินค้าใหม่ (คงรองรับข้อความเก่าแบบย้อนหลัง)
ก่อนหน้า (รอบสำคัญ)

ปรับ UX admin dashboard ให้จัดหมวดชัด
เพิ่มระบบ RCON queue + retry + audit
เพิ่ม rentbike daily flow + cleanup/reset
เพิ่ม watcher hardening + dedupe/dead-letter
เพิ่ม integration tests ครอบคลุม flow สำคัญ
เพิ่ม security hardening สำหรับ admin/webhook
9) แผนผังไฟล์สำคัญ
Bot entry: src/bot.js
Admin server: src/adminWebServer.js
Admin UI: src/admin/dashboard.html, src/admin/login.html
Webhook server: src/scumWebhookServer.js
Watcher: scum-log-watcher.js
RCON delivery: src/services/rconDelivery.js
Rent bike service: src/services/rentBikeService.js
Config: src/config.js
Tests: test/*.test.js
Security check script: scripts/security-check.js
10) กติกาการอัปเดตเอกสาร
ตั้งแต่ตอนนี้เป็นต้นไป:

ให้ใช้ไฟล์นี้เป็นไฟล์หลักเพียงไฟล์เดียว
ทุกครั้งที่อัปเดตระบบ ให้เขียนรายละเอียดในหัวข้อ:
What changed
Why
Impact
How tested
หลีกเลี่ยงแยก changelog ไปหลายไฟล์เพื่อกันข้อมูลไม่ตรงกัน
