# System Updates Log

เอกสารนี้ใช้บันทึกการเปลี่ยนแปลงทุกครั้งที่มีการอัปเดตระบบจริง

## วิธีใช้งาน

1. ทุกครั้งที่แก้ระบบ ให้เพิ่มหัวข้อวันที่ใหม่
2. ระบุ `เป้าหมาย`, `สิ่งที่เปลี่ยน`, `ผลกระทบ`, `วิธีทดสอบ`
3. อ้างอิงไฟล์ที่แก้หลักอย่างน้อย 1 จุด

---

## 2026-03-06

### เป้าหมาย
- ปิดงานค้าง A-D จากรีวิวโปรเจกต์

### สิ่งที่เปลี่ยน
- แก้ข้อความ legacy/mojibake ในระบบหลักให้เป็น UTF-8
- เพิ่ม integration tests:
  - flow ซื้อสินค้า -> queue -> ส่งของสำเร็จ
  - admin API auth + validation
  - watcher parse log หลายรูปแบบ
- บังคับมาตรฐาน RCON bundle template:
  - ถ้าเป็นหลายไอเทม ต้องมี `{gameItemId}` หรือ `{quantity}`
  - ถ้าไม่ตรงเงื่อนไขจะ reject ตอน enqueue
- เพิ่ม observability/alerts:
  - queue length
  - delivery fail rate
  - watcher webhook error rate
  - admin login failure spikes
- เพิ่ม endpoint `GET /admin/api/observability`
- เพิ่มสคริปต์ guard ป้องกัน mojibake เข้าโค้ดอีก:
  - `scripts/check-text-encoding.js`
  - ผูกเข้ากับ `npm run lint`

### ผลกระทบ
- เพิ่มความปลอดภัยเชิงคุณภาพของ release
- ลดความเสี่ยงส่งของผิดรายการใน bundle
- ทีมแอดมินติดตามปัญหา production ได้ไวขึ้น

### วิธีทดสอบ
- `npm run lint`
- `npm test`

### ไฟล์หลักที่อัปเดต
- `src/adminWebServer.js`
- `src/services/rconDelivery.js`
- `scum-log-watcher.js`
- `test/admin-api.integration.test.js`
- `test/rcon-delivery.integration.test.js`
- `test/scum-log-watcher.parse.test.js`
- `scripts/check-text-encoding.js`
- `package.json`

---

## 2026-03-06 (QA Hardening รอบเพิ่มความครบถ้วน)

### เป้าหมาย
- เพิ่มความครอบคลุม integration test ในจุดที่กระทบ production โดยตรง
- ปิดช่องว่างการแมตช์ไอคอนสำหรับ blueprint item id ที่ลงท้าย `_C`

### สิ่งที่เปลี่ยน
- เพิ่ม test ใหม่ `test/scum-webhook.integration.test.js`
  - ตรวจ 404/403/400 และ success path ของ `/scum-event`
  - ตรวจว่าการ dispatch event ส่ง payload ไป service ครบ
- เพิ่ม test ใหม่ `test/item-icon-service.test.js`
  - ตรวจโหมดโหลดจาก `SCUM_ITEMS_INDEX_PATH`
  - ตรวจ fallback โหมด `SCUM_ITEMS_DIR_PATH`
  - ตรวจ alias จาก `BP_WEAPON_AK47_C` ไปไอคอน `Weapon_AK47.webp`
- ปรับ `src/services/itemIconService.js`
  - เพิ่ม normalization variant สำหรับ `_C` suffix
- ปรับ `src/scumWebhookServer.js`
  - ให้ `startScumServer()` คืนค่า `server` สำหรับใช้ใน automation test / controlled shutdown

### ผลกระทบ
- ลดความเสี่ยง event webhook ทำงานผิดเส้นทางแล้วจับไม่ได้
- ลดความเสี่ยงไอคอนไม่ขึ้นเมื่อ game item id มาในรูป blueprint class
- เพิ่มความเสถียรของชุดทดสอบอัตโนมัติ

### วิธีทดสอบ
- `npm run check`
- `npm run doctor`

### ผลทดสอบล่าสุด
- `npm test`: ผ่าน 13/13
- `npm run check`: ผ่าน
- `npm run doctor`: ผ่าน

### ไฟล์หลักที่อัปเดต
- `src/scumWebhookServer.js`
- `src/services/itemIconService.js`
- `test/scum-webhook.integration.test.js`
- `test/item-icon-service.test.js`
- `PROJECT_REVIEW.md`
