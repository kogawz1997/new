# นโยบายความเป็นส่วนตัว (Privacy Policy)

อัปเดตเวอร์ชัน: `2026-03`

## 1. ข้อมูลที่ระบบอาจเก็บ

- Discord account identifier และข้อมูล profile ที่จำเป็นต่อการยืนยันตัวตน
- Steam/SCUM binding, player account profile และสถานะคำสั่งส่งของ
- wallet, purchase history, reward/redeem history, delivery log, audit log และ runtime monitoring
- tenant, subscription, license, API key metadata, webhook endpoint และ agent heartbeat

## 2. วัตถุประสงค์ของการใช้ข้อมูล

- เพื่อให้ระบบร้าน, ส่งของ, ยืนยันตัวตน, ติดตามธุรกรรม และบริการหลังบ้านทำงานได้
- เพื่อป้องกัน abuse, วิเคราะห์ incident, reconcile ธุรกรรม และตรวจสอบ runtime health
- เพื่อสนับสนุนการสำรองข้อมูล, restore, legal acceptance และการบริหาร tenant/subscription

## 3. การคุ้มครองข้อมูล

- secret, token, API key และ session secret ต้องถูกเก็บผ่าน environment หรือ secret management ที่เหมาะสม
- ระบบควรเปิด secure cookie, origin checks, 2FA และแยก admin/player คนละ origin ใน production
- ควรจำกัดสิทธิ์การเข้าถึง backup, export, audit และ config editor เฉพาะผู้มีสิทธิ์ที่เหมาะสม

## 4. การแบ่งปันข้อมูล

- ระบบอาจส่งข้อมูลบางส่วนไปยัง webhook ภายนอกตามที่ tenant หรือ owner ตั้งค่า
- payload ของ webhook ควรถูกป้องกันด้วย signature/secret และจำกัดข้อมูลเท่าที่จำเป็น
- ระบบจะไม่เปิดเผยข้อมูลผู้เล่นหรือ tenant แก่บุคคลที่ไม่เกี่ยวข้อง เว้นแต่ผู้ดูแลระบบปลายทางเป็นผู้ตั้งค่าไว้ชัดเจน

## 5. ระยะเวลาการเก็บรักษา

ระยะเวลาการเก็บรักษาขึ้นกับนโยบายของผู้ดูแลระบบปลายทาง รวมถึงรอบ backup, audit retention, notification retention, และ session TTL

## 6. สิทธิ์ของเจ้าของข้อมูล

ผู้ดูแลปลายทางควรมีช่องทางให้ผู้เล่นร้องขอแก้ไข binding, ตรวจสอบประวัติธุรกรรม หรือขอลบข้อมูลที่ไม่จำเป็นตามนโยบายของเซิร์ฟเวอร์และกฎหมายที่เกี่ยวข้อง
