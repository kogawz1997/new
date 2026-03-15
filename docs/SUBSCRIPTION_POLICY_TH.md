# นโยบายสมาชิกและการสมัครใช้งาน (Subscription Policy)

อัปเดตเวอร์ชัน: `2026-03`

## 1. ประเภทแผนบริการ

- `trial`: ใช้สำหรับ proof-of-concept, demo server และการประเมินความพร้อมก่อนขึ้นจริง
- `subscription`: ใช้สำหรับ production tenant ที่มีรอบการต่ออายุ
- `one-time`: ใช้สำหรับงานติดตั้งหรือบริการเฉพาะครั้ง

## 2. รอบบิลและการต่ออายุ

- ระบบรองรับ `trial`, `monthly`, `quarterly`, `yearly` และ `one-time`
- การต่ออายุถูกเก็บใน subscription record และควรเชื่อมกับระบบ billing ภายนอกหากมี
- กรณีสถานะ `past_due`, `paused`, `canceled` หรือ `expired` ผู้ดูแลควรตรวจสอบผลกระทบต่อ runtime, support และ license

## 3. License และ legal acceptance

- tenant แต่ละรายควรมี license ที่ผูกกับจำนวน seat, สถานะ, วันหมดอายุ และ version ของ legal docs
- ก่อนเปิดใช้งานจริง ควรเก็บ `legalAcceptedAt` และ `legalDocVersion` ให้ครบ

## 4. Marketplace และ reseller

- หากเปิด marketplace/reseller ผู้ดูแลควรกำหนด offering, commission, currency และ pricing policy ให้ชัดเจน
- การขาย service/addon ผ่าน marketplace ควรสอดคล้องกับ subscription plan และ license policy

## 5. การยกเลิกและคืนเงิน

- การคืนเงินหรือยกเลิก subscription ควรบันทึก reference ภายนอกและ metadata เพื่อใช้ audit/reconcile ภายหลัง
- หากมีการปรับลดสิทธิ์หลังยกเลิก ควรมีขั้นตอนแจ้งเตือน tenant และตรวจสอบผลต่อ runtime/service access
