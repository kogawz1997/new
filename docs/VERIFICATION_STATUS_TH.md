# Verification Status

เอกสารนี้เป็น source of truth เดียวสำหรับสถานะการตรวจสอบคุณภาพของโปรเจกต์ในระดับ repo

หลักฐานที่เชื่อถือได้:
- GitHub Actions workflow: `.github/workflows/ci.yml`
- GitHub Actions release workflow: `.github/workflows/release.yml`
- workflow artifacts ที่ job `verification-artifacts` สร้างไว้ใน `artifacts/ci/`
- `verification-summary.json` ที่สร้างจาก `ci:verify` โดยใช้ test-safe env profile แบบ deterministic

หมายเหตุเรื่อง CI artifact:
- job `verification-artifacts` ถูกตั้งให้รันแบบ `always()` หลัง matrix/clean-room checks
- ดังนั้นถึงแม้บาง job ก่อนหน้าจะล้ม CI ก็ยังพยายามสร้าง summary/log artifact ให้ใช้ debug ต่อได้

สิ่งที่ไม่ควรใช้เป็น source of truth:
- ตัวเลข test count ที่พิมพ์ค้างไว้ใน README
- badge แบบ hardcode
- ข้อความ “ผ่านแล้ว” ที่ไม่ได้ผูกกับ workflow run จริง

artifact หลักที่ CI สร้าง:
- `artifacts/ci/verification-summary.json`
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/lint.log`
- `artifacts/ci/test.log`
- `artifacts/ci/doctor.log`
- `artifacts/ci/security-check.log`
- `artifacts/ci/readiness.log`
- `artifacts/ci/smoke.log`

สถานะที่ควรอ้างอิงในเอกสารภายนอก:
- CI badge จาก workflow จริง
- release tag ล่าสุด
- workflow artifact ล่าสุด

การตรวจแบบ local ที่ใกล้เคียง CI ที่สุด:
```bash
npm run env:prepare:test
npm ci
npm run db:generate
npx prisma db push --skip-generate
npm run ci:verify
```

การตรวจแบบ local โดยไม่แตะ `.env` ปัจจุบัน:
```bash
npm run ci:verify
```

หมายเหตุ:
- `ci:verify` จะ inject ค่าจาก `.env.example + .env.test.example` และ portal test profile เข้า subprocess เอง
- ดังนั้นผล `ci:verify` จะไม่อิง `.env` ปัจจุบันบนเครื่อง ถ้าไม่มี script ใด override เพิ่ม
- ส่วน `env:prepare:test` ยังเหมาะกับ clean-room install, GitHub Actions, หรือ workspace ใหม่มากกว่า
- `ci:verify` จะรัน `lint`, `test`, `doctor`, `security:check`, `readiness:full`, และ `smoke:local-ci`
- ถ้าต้องการตรวจ production boundary ให้ใช้ `readiness:prod` และ `smoke:postdeploy` แยกจาก CI local stack
