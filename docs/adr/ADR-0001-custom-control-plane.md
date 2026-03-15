# ADR-0001: Why This Project Uses a Custom SCUM Control Plane

## Status

Accepted

## Context

โปรเจกต์นี้ไม่ได้เป็นแค่ Discord bot แต่ทำหน้าที่เป็น control plane สำหรับ SCUM server ทั้งก้อน:
- Discord bot
- worker
- watcher
- admin web
- player portal
- console-agent

SCUM delivery runtime มีข้อจำกัดเฉพาะทาง:
- บางคำสั่งทำผ่าน RCON ได้ แต่บาง flow ต้องอาศัย admin client จริง
- order debug ต้อง trace ผ่านหลาย process
- operator ต้องมีหน้า control plane ที่ยังเข้าได้แม้ bot runtime มีปัญหา

## Decision

เราเลือกทำ runtime และ admin surface แบบ custom แทนการพึ่ง bot framework หรือ dashboard framework สำเร็จรูปอย่างเดียว

ส่วนที่ทำ custom เพราะเหตุผลชัดเจน:
- delivery execution abstraction ต้องแยก `RCON` กับ `agent mode`
- order timeline / step log / evidence bundle ต้องผูกกับ flow ของเกมจริง
- restore guardrails, step-up auth, live admin control, และ capability testing ต้อง integrate กันลึก
- watcher / queue / retry / dead-letter ต้องมี semantics ที่ตรงกับ SCUM operations

## Consequences

ข้อดี:
- คุม operational flow ได้ละเอียด
- debug production ได้จาก domain model ที่ตรงกับงานจริง
- เพิ่ม commercial/admin UX เฉพาะทางได้เร็ว

ข้อเสีย:
- maintenance cost สูงกว่า generic bot
- docs / CI / migration policy ต้องละเอียดกว่าปกติ
- ต้องระวัง runtime boundary ระหว่าง bot / worker / watcher / web / agent มากขึ้น

## Evidence

- `src/services/rconDelivery.js`
- `src/adminWebServer.js`
- `src/services/scumConsoleAgent.js`
- `docs/ARCHITECTURE.md`
- `docs/DELIVERY_CAPABILITY_MATRIX_TH.md`
