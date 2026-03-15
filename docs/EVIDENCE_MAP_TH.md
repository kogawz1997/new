# Evidence Map

เอกสารนี้ใช้ตอบคำถามว่า "คำกล่าวอ้างใน repo มีหลักฐานอะไรบ้าง" โดยให้ดูจากไฟล์จริง, test จริง, และ artifact จริงก่อนคำอธิบายเชิง narrative

## 1. Source of Truth

หลักฐานหลักที่ควรใช้อ้างอิง:
- CI workflow: `.github/workflows/ci.yml`
- Release workflow: `.github/workflows/release.yml`
- verification summary: `artifacts/ci/verification-summary.json`
- verification report: `artifacts/ci/verification-summary.md`
- CI logs:
  - `artifacts/ci/lint.log`
  - `artifacts/ci/test.log`
  - `artifacts/ci/security-check.log`
  - `artifacts/ci/readiness.log`
  - `artifacts/ci/smoke.log`

เอกสารรองที่สรุปจากหลักฐาน:
- [docs/VERIFICATION_STATUS_TH.md](./VERIFICATION_STATUS_TH.md)
- [docs/DELIVERY_CAPABILITY_MATRIX_TH.md](./DELIVERY_CAPABILITY_MATRIX_TH.md)
- [docs/LIMITATIONS_AND_SLA_TH.md](./LIMITATIONS_AND_SLA_TH.md)
- [docs/MIGRATION_ROLLBACK_POLICY_TH.md](./MIGRATION_ROLLBACK_POLICY_TH.md)

## 2. Feature -> Code -> Test -> Artifact

| Feature | Runtime / Code | Tests | Artifact / Log |
| --- | --- | --- | --- |
| delivery queue, retry, dead-letter, timeline | `src/services/rconDelivery.js` | `test/rcon-delivery.integration.test.js` | `artifacts/ci/test.log` |
| execution backend split `rcon` vs `agent` | `src/services/rconDelivery.js`, `src/services/scumConsoleAgent.js` | `test/rcon-delivery.integration.test.js` | `docs/DELIVERY_CAPABILITY_MATRIX_TH.md` |
| admin preflight / simulator / capability test | `src/adminWebServer.js`, `src/admin/dashboard.html` | `test/admin-api.integration.test.js` | `artifacts/ci/test.log` |
| admin auth, step-up, session revoke, security events | `src/adminWebServer.js`, `src/utils/adminPermissionMatrix.js` | `test/admin-api.integration.test.js`, `test/admin-permission-matrix.test.js` | `artifacts/ci/test.log` |
| restore preview, compatibility, maintenance gate | `src/services/adminSnapshotService.js`, `src/store/adminRestoreStateStore.js` | `test/admin-snapshot-compatibility.test.js`, `test/admin-api.integration.test.js` | `artifacts/ci/test.log` |
| watcher / webhook ingestion | `src/services/scumLogWatcherRuntime.js`, `src/scumWebhookServer.js` | `test/scum-webhook.integration.test.js` | `artifacts/ci/test.log` |
| player portal mode | `apps/web-portal-standalone/server.js` | `test/web-portal-standalone.player-mode.integration.test.js` | `artifacts/ci/test.log` |
| secret hygiene / secret scanning | `scripts/secret-scan.js`, `.githooks/pre-commit`, `.githooks/pre-push` | `test/secret-scan.test.js` | `artifacts/ci/security-check.log` |
| readiness / smoke / deploy boundary | `scripts/doctor.js`, `scripts/security-check.js`, `scripts/readiness-gate.js`, `scripts/post-deploy-smoke.js` | `test/doctor.integration.test.js`, `test/security-check.integration.test.js` | `artifacts/ci/doctor.log`, `artifacts/ci/readiness.log`, `artifacts/ci/smoke.log` |

## 3. Current Evidence Excerpts

จาก `artifacts/ci/verification-summary.md`
- overall status: `PASSED`
- lint, test, doctor, security check, readiness, local smoke ผ่านครบ

จาก `artifacts/ci/smoke.log`
- admin health, login page, player health, player login, console-agent health ผ่าน
- local CI profile ยัง `SKIP` admin OAuth start ถ้า SSO ถูกปิดใน test overlay

จาก `artifacts/ci/test.log`
- มี integration tests ครอบ admin API, restore compatibility, delivery runtime, player mode, webhook ingestion, และ auth hardening

## 4. Evidence That Is Still Missing From Repo

ยังไม่มีไฟล์หลักฐานชนิดต่อไปนี้ใน repo ตอนนี้:
- screenshot dashboard จริง
- demo GIF
- architecture image แบบ export เป็นภาพ
- release notes แบบเขียนแยกราย release นอกเหนือจาก `CHANGELOG.md`

ดังนั้นถ้าจะอ้างหลักฐานในตอนนี้ ควรอ้าง:
- code path
- test file
- CI artifact
- smoke/readiness output

ไม่ควรอ้างว่า:
- มี screenshot แล้ว ทั้งที่ยังไม่ได้ commit
- มี demo GIF แล้ว ทั้งที่ยังไม่ได้ track
- มี proof game-side 100% ทุกกรณี ถ้ายังเป็นเพียง command-level verification

## 5. How To Read Claims In This Repo

- ถ้า claim ผูกกับ test file และ artifact ได้ ให้ถือว่า `verified`
- ถ้า claim ผูกกับ code path ได้ แต่ยังไม่มี test/end-to-end proof ให้ถือว่า `implemented`
- ถ้า claim ยังขึ้นกับ runtime ภายนอก เช่น SCUM client, Windows session, หรือ game patch ให้ถือว่า `operational dependency`
- ถ้า claim ยังไม่มีไฟล์หลักฐานเลย ให้ถือว่าเป็นเพียง `planned` หรือ `demo note`
