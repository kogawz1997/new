# Verification Status

เอกสารนี้เป็น source of truth สำหรับสถานะการตรวจสอบคุณภาพของ repo

## อะไรคือหลักฐานที่ควรเชื่อ

- GitHub Actions workflow: `.github/workflows/ci.yml`
- GitHub Actions release workflow: `.github/workflows/release.yml`
- artifact ที่ job `verification-artifacts` สร้างไว้ใน `artifacts/ci/`
- `verification-summary.json` และ `verification-summary.md` ที่สร้างจาก `npm run ci:verify`

## อะไรไม่ควรใช้เป็น source of truth

- ตัวเลข test count ที่เขียนค้างไว้ในเอกสาร
- ข้อความว่า “ผ่านแล้ว” ที่ไม่มี log หรือ artifact รองรับ
- badge หรือ summary ที่ไม่ได้ผูกกับ workflow จริง

## Artifact หลักที่ CI สร้าง

- `artifacts/ci/verification-summary.json`
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/lint.log`
- `artifacts/ci/test.log`
- `artifacts/ci/doctor.log`
- `artifacts/ci/security-check.log`
- `artifacts/ci/readiness.log`
- `artifacts/ci/smoke.log`

## Local verification ที่ใกล้เคียง CI ที่สุด

```bash
npm run ci:verify
```

หมายเหตุ:

- `ci:verify` จะ inject test-safe env ให้ subprocess เอง
- จึงไม่ควรต้องพึ่ง `.env` ปัจจุบันของเครื่อง
- ถ้าต้องการตรวจ production boundary ให้ใช้ `readiness:prod` และ `smoke:postdeploy`

## คำสั่งที่ใช้บ่อย

```bash
npm run lint
npm test
npm run doctor
npm run security:check
npm run readiness:prod
npm run smoke:postdeploy
```

## สถานะล่าสุดที่ควรอ้างอิง

ให้ดูจาก:

- CI badges ใน [README.md](../README.md)
- `artifacts/ci/verification-summary.md`
- `artifacts/ci/verification-summary.json`
