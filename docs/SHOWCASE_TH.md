# Demo Notes

เอกสารนี้ไม่ใช่ source of truth หลักของสถานะระบบ

ให้ใช้เอกสารนี้เมื่อจะสาธิตระบบหรืออธิบาย flow เพิ่มเติมเท่านั้น
ส่วนสถานะที่ควรอ้างจริงให้ดู:
- [README.md](../README.md)
- [PROJECT_HQ.md](../PROJECT_HQ.md)
- [docs/VERIFICATION_STATUS_TH.md](./VERIFICATION_STATUS_TH.md)
- [docs/EVIDENCE_MAP_TH.md](./EVIDENCE_MAP_TH.md)

## 1. สิ่งที่สาธิตได้ตอนนี้

- admin dashboard runtime overview
- delivery timeline / step log
- preflight / simulator / capability test
- notification center
- backup / restore preview
- player portal login / wallet / purchase history / redeem

## 2. ลำดับการสาธิต

1. เปิด admin dashboard เพื่อดู topology และ runtime status
2. เปิด delivery runtime เพื่อดู queue, dead-letter, verification mode
3. รัน preflight เพื่อดูว่า worker / agent / target พร้อมหรือไม่
4. รัน simulator เพื่อดู command plan แบบไม่ยิงจริง
5. รัน capability test `announce / teleport / spawn`
6. เปิด order detail เพื่อดู timeline, step log, outputs, evidence
7. เปิด player portal เพื่อดู wallet, history, redeem, profile

## 3. สิ่งที่ควรเปิดคู่กัน

- `artifacts/ci/verification-summary.md`
- `artifacts/ci/smoke.log`
- `docs/DELIVERY_CAPABILITY_MATRIX_TH.md`
- `docs/LIMITATIONS_AND_SLA_TH.md`
- `docs/MIGRATION_ROLLBACK_POLICY_TH.md`

ควรเปิดหลักฐานควบคู่ไปกับ UI

## 4. ข้อจำกัดของการสาธิต

- screenshot dashboard จริงยังไม่ได้ถูก commit ใน repo
- demo GIF ยังไม่มีใน repo
- ถ้าจะสาธิต `agent mode` ต้องใช้ Windows session และ SCUM admin client จริง
- บางความสามารถของ admin web ยังต้องดูจาก env/config และ API route มากกว่าฟอร์มบนหน้าเว็บ

## 5. สิ่งที่ไม่ควรพูดเกินจริง

- อย่าพูดว่า RCON spawn ใช้ได้กับทุกเซิร์ฟเวอร์ ถ้ายังไม่ได้พิสูจน์กับ environment นั้น
- อย่าพูดว่า restore เป็น one-click rollback เต็มรูปแบบ เพราะยังมี maintenance gate และ manual confirmation
- อย่าพูดว่า SQLite พร้อม horizontal scale
- อย่าพูดว่า agent mode เป็น official server API
