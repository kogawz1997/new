# DB Engine Migration Path

ปัจจุบันระบบใช้ Prisma + SQLite เป็น baseline สำหรับ single-node deployment

ถ้าจะโตไปหลายเครื่อง / หลาย worker / multi-tenant จริงจัง ควรวางทางย้ายไป `PostgreSQL` หรือ `MySQL` ตามลำดับนี้

## เป้าหมาย

- แยก database ออกจาก local disk
- ลดข้อจำกัดเรื่อง file locking ของ SQLite
- รองรับหลาย service พร้อมกันได้ดีขึ้น
- ทำ backup / restore / migration ในระดับ production ได้ปลอดภัยขึ้น

## สิ่งที่พร้อมแล้ว

- data access หลักวิ่งผ่าน Prisma
- `DATABASE_URL` เป็นตัวกำหนด connection หลัก
- มี migration / rollback / restore policy แยกไว้แล้ว
- มี `db:migrate:deploy:safe` สำหรับ path ปัจจุบันที่เป็น SQLite

## สิ่งที่ต้องเปลี่ยนเมื่อย้าย engine

1. เปลี่ยน `datasource db.provider` ใน `prisma/schema.prisma`
2. ปรับ `DATABASE_URL` ให้เป็น PostgreSQL/MySQL
3. สร้าง migration baseline ใหม่สำหรับ engine เป้าหมาย
4. รัน data export/import หรือ dual-write migration ตาม maintenance plan
5. รัน `doctor`, `security:check`, `readiness:prod`, `smoke:postdeploy`

## แนะนำลำดับ

1. เริ่มจาก PostgreSQL ก่อนถ้าต้องการ transactional workload และ observability ดีกว่า
2. ใช้ MySQL เมื่อ environment ลูกค้าผูกกับ ecosystem นั้นอยู่แล้ว
3. อย่าย้าย engine พร้อม release ใหญ่ตัวเดียว ควรแยก maintenance window

## ข้อจำกัดที่ยังต้องทำต่อ

- schema ปัจจุบันยังตั้ง `provider = "sqlite"` แบบตรง ๆ
- ยังไม่มี automated engine-switch migration ใน repo
- rollback ข้าม engine ยังต้องใช้ backup/restore plan ระดับ operation

อ้างอิง:
- `prisma/schema.prisma`
- `docs/MIGRATION_ROLLBACK_POLICY_TH.md`
- `docs/DATA_LAYER_MIGRATION.md`
