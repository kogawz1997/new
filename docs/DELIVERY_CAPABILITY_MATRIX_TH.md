# Delivery Capability Matrix

เอกสารนี้แยกให้ชัดว่า feature ไหนใช้ `RCON`, feature ไหนต้องใช้ `agent mode`, และจุดไหนมี fallback ได้

| Capability | RCON | Agent mode | Failover/Fallback | Evidence |
| --- | --- | --- | --- | --- |
| enqueue / queue / retry / dead-letter | yes | yes | ใช้ร่วมกัน | audit + timeline |
| preflight ก่อน enqueue | partial | required | agent fail => block หรือ failover ตาม policy | audit + preflight report |
| teleport ไปหาผู้เล่น | no | yes | fallback เป็น RCON ได้เฉพาะ path ที่ไม่ต้อง teleport | timeline + outputs |
| teleport ไป vehicle target | no | yes | same as above | timeline + outputs |
| spawn item ปกติ | yes | yes | yes | outputs + latest command summary |
| multi-item / bundle | yes | yes | yes | outputs + step log |
| magazine StackCount | yes | yes | yes | preview + outputs |
| post-spawn verification | partial | yes | verify fail => retry/dead-letter | verify audit + evidence bundle |
| capability test / simulate | yes | yes | n/a | simulator + preview |
| command template override | yes | yes | n/a | audit trail |

execution backend ที่ runtime บันทึกต่อ order:
- `executionMode`
- `backend`
- `commandPath`
- `retryCount`

หลักฐานต่อ order ที่ใช้ debug ย้อนหลัง:
- `deliveryAudit`
- `statusHistory`
- `timeline`
- `stepLog`
- `latestOutputs`
- `evidence` bundle file ต่อ `purchaseCode`

ไฟล์โค้ดหลัก:
- `src/services/rconDelivery.js`
- `src/store/deliveryAuditStore.js`
- `src/store/deliveryEvidenceStore.js`
- `src/services/scumConsoleAgent.js`

ชุดทดสอบอ้างอิง:
- `test/rcon-delivery.integration.test.js`
- `test/admin-api.integration.test.js`

policy ปัจจุบัน:
- ถ้า `agent mode` ถูกเลือก ระบบจะทำ preflight ก่อน enqueue งานจริง
- ถ้า agent ไม่พร้อมและเปิด failover policy ระบบจะ switch ไป `RCON`
- ถ้า verify fail ระบบจะเข้าสู่ retry / dead-letter ตาม policy เดิม
- idempotency window ยังใช้ guard เดิมเพื่อกัน success ซ้ำ
