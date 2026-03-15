# ENV Profiles

ตอนนี้ repo แยก profile สำหรับ `development`, `test`, และ `production` ชัดขึ้นแล้ว

ไฟล์ที่ใช้:
- root base: `.env.example`
- root overlays: `.env.development.example`, `.env.test.example`, `.env.production.example`
- portal base: `apps/web-portal-standalone/.env.example`
- portal overlays: `apps/web-portal-standalone/.env.development.example`, `apps/web-portal-standalone/.env.test.example`, `apps/web-portal-standalone/.env.production.example`

คำสั่งช่วยเตรียม env:
```bash
npm run env:preview:development
npm run env:preview:test
npm run env:preview:production

npm run env:prepare:development
npm run env:prepare:test
npm run env:prepare:production
```

แนวคิด:
- base example เก็บตัวแปรทั้งหมด
- overlay profile เก็บเฉพาะค่าที่ควรต่างตาม environment
- script `scripts/setup-env-profile.js` จะ merge base + overlay แล้ว materialize เป็น `.env`

คำเตือน:
- `env:prepare:*` จะเขียน `.env` และ `apps/web-portal-standalone/.env` เฉพาะเมื่อไฟล์ปลายทางยังไม่มีอยู่
- ใช้ใน clean-room install, CI, หรือเครื่อง dev ใหม่ได้
- ถ้าจำเป็นต้องเขียนทับจริง ให้เรียก `scripts/setup-env-profile.js --write --force` โดยตรง ซึ่ง script จะ backup ไฟล์เดิมไว้ใน `data/env-profile-backups/`
- สำหรับ production จริงยังควรใช้ secret rotation / split-origin tooling เดิมร่วมด้วย

แนะนำการใช้งาน:
- dev machine: `npm run env:prepare:development`
- CI / clean-room: `npm run env:prepare:test`
- production bootstrap: `npm run env:prepare:production` แล้วหมุน secrets ต่อทันที
