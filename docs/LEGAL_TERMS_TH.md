# ข้อกำหนดการใช้งานแพลตฟอร์ม (Terms of Service)

อัปเดตเวอร์ชัน: `2026-03`

## 1. ขอบเขตบริการ

แพลตฟอร์มนี้ให้บริการระบบร้านค้าในเกม SCUM, ระบบส่งของอัตโนมัติ, เว็บผู้เล่น, เว็บแอดมิน, ระบบมอนิเตอร์, ระบบสำรองข้อมูล และ API/Webhook สำหรับการเชื่อมต่อภายนอก

## 2. การใช้งานที่ยอมรับได้

- ผู้ใช้งานต้องไม่ใช้ระบบนี้เพื่อหลีกเลี่ยงกฎของเซิร์ฟเวอร์เกมหรือกฎของ Discord
- ห้ามใช้ API, webhook, agent หรือคำสั่งส่งของเพื่อพยายามรันคำสั่งนอกขอบเขตที่ระบบอนุญาต
- ผู้ดูแลต้องเก็บ secret, token, session secret และ license key เป็นความลับ

## 3. สิทธิ์การเข้าถึง

- สิทธิ์ admin, owner, mod, tenant API key และ agent scope เป็นสิทธิ์คนละชั้นกัน
- ผู้ดูแลต้องตั้งค่า RBAC, 2FA, callback origin และ session policy ให้สอดคล้องกับสภาพแวดล้อม production
- การกระทำผ่าน admin surface หรือ public API จะถูกบันทึกใน audit/notification/runtime log ตามที่ระบบรองรับ

## 4. การส่งของและการยืนยันผล

- ระบบ delivery รองรับการทำงานผ่าน RCon หรือ agent mode ตามการตั้งค่า
- สถานะ `command success` ไม่ได้หมายความว่าของเข้าถึง inventory ปลายทางทุกกรณี จนกว่าจะมีการยืนยันผ่าน verify/log/runtime flow ที่เปิดใช้งาน
- ผู้ให้บริการควรทดสอบ capability, preflight, simulate และ dry-run ทุกครั้งก่อนใช้งานกับคำสั่งหรือ item template ใหม่

## 5. ความพร้อมใช้งาน

- ระบบถูกออกแบบให้รองรับ bot, worker, watcher, web และ console-agent แยก process ได้
- ผู้ใช้งานต้องตั้ง monitoring ภายนอก, backup automation, alerting และ go-live checklist ให้ครบก่อนเปิด production
- กรณี runtime ภายนอก เช่น Windows session, SCUM admin client หรือ topology production ไม่พร้อม ผู้ให้บริการไม่รับประกันว่าการส่งของจะสำเร็จ

## 6. ข้อมูลและการสำรองข้อมูล

- ผู้ดูแลเป็นผู้รับผิดชอบการตรวจสอบ backup, restore preview, snapshot diff และ maintenance mode ก่อน restore
- หากผู้ดูแลนำ backup ผิดชุดไป restore หรือใช้ config เก่าทับ production ถือเป็นความรับผิดชอบของผู้ดูแลระบบปลายทาง

## 7. การเปลี่ยนแปลงบริการ

ผู้ให้บริการสามารถอัปเดต version, feature, legal docs, billing plan, webhook payload หรือ policy ได้ โดยควรประกาศ version เอกสารใหม่ในระบบ license/legal acceptance

## 8. การยกเลิกบริการ

ผู้ให้บริการสามารถระงับหรือเพิกถอนสิทธิ์ใช้งานได้ หากพบการใช้ระบบในทางที่ผิด, ฝ่าฝืนกติกาเซิร์ฟเวอร์, หรือเสี่ยงต่อความปลอดภัยของระบบรวม
