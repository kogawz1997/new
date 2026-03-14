# คู่มือแอดมินใช้งานประจำวัน

เอกสารนี้เป็นคู่มือใช้งานประจำวันของแอดมิน ไม่ใช่คู่มือติดตั้งระบบ

อัปเดตล่าสุด: **2026-03-13**

อ้างอิงหลัก
- ภาพรวมระบบ: [../README.md](../README.md)
- คู่มือปฏิบัติการ: [OPERATIONS_MANUAL_TH.md](./OPERATIONS_MANUAL_TH.md)
- คู่มือ env: [ENV_REFERENCE_TH.md](./ENV_REFERENCE_TH.md)

---

## 1. จุดที่ต้องเปิดไว้ทุกวัน

runtime หลักที่ควร online
- `scum-bot-local`
- `scum-worker-local`
- `scum-watcher-local`
- `scum-web-portal-local`
- `scum-console-agent-local`

ถ้าใช้ production names จริงใน PM2 ให้เทียบตาม process ของเครื่องจริง

เช็กสถานะ

```bat
pm2 status
```

สิ่งที่ต้องดู
- `status = online`
- worker มี heartbeat
- console agent reachable

---

## 2. หน้าแอดมินที่ใช้บ่อย

### 2.1 Delivery Runtime
ใช้ดู
- queue
- dead-letter
- worker health
- agent health
- command preview

ใช้เมื่อ
- สงสัยว่าของไม่เข้า
- ต้อง retry
- ต้อง cancel
- ต้อง test send

### 2.2 Audit Center
ใช้ดูย้อนหลัง
- wallet
- reward
- event
- delivery references

ใช้ filter ได้
- q
- user
- actor
- reason
- status
- reference
- dateFrom / dateTo
- sort / order
- page / cursor

### 2.3 Snapshot / Backup
ใช้ก่อน
- update ใหญ่
- เปลี่ยน config มาก
- migrate data

---

## 3. งานประจำวันของแอดมิน

### 3.1 เช็กระบบตอนเริ่มวัน

1. เปิด PM2 status
2. เข้า admin web
3. ดู Delivery Runtime
4. ดู Audit Center ว่ามี fail/dead-letter ค้างหรือไม่
5. ดู watcher/queue/worker health

เช็กด้วยคำสั่ง

```bat
pm2 status
npm run doctor
```

### 3.2 เช็กว่าระบบส่งของพร้อม

ดูที่หน้าแอดมิน
- worker health = reachable
- agent health = reachable
- execution mode = `agent`
- queue ไม่ค้างผิดปกติ

ถ้าจะเช็กเชิงลึก
- ใช้ `Delivery Preview`
- ใช้ `Test Send`

### 3.3 เช็ก player portal

ดูว่า
- login เข้าได้
- dashboard โหลด
- wallet / shop / order history โหลด

ถ้ามีปัญหา JSON แปลก
- เช็ก log ฝั่ง portal
- เช็ก env callback path และ OAuth

---

## 4. วิธีส่งของ/รีทราย

### 4.1 เมื่อมี order ปกติ
ระบบจะวิ่งเอง:

```text
purchase
-> queue
-> worker
-> console agent
-> SCUM admin client
-> teleport/spawn
```

### 4.2 ถ้าของไม่เข้า

เปิดหน้า `Delivery Runtime`

ดูตามนี้
1. queue ยังอยู่หรือไม่
2. ไป dead-letter หรือไม่
3. detail endpoint แสดง command อะไร
4. command log ล่าสุดเป็นอะไร

### 4.3 Retry

จากตาราง queue/dead-letter
- กด `retry`

ก่อน retry ควรเช็ก
- console agent online
- SCUM admin client ยังเปิดอยู่
- อยู่ admin channel ถูก
- teleport target ยังใช้ได้

### 4.4 Cancel

ใช้เมื่อ
- order test
- คำสั่งผิด
- ไม่ควรส่งต่อแล้ว

จากหน้าแอดมิน
- กด `cancel`

---

## 5. งานเกี่ยวกับ SCUM admin client

ตอนนี้ delivery ใช้ `agent mode` เป็นหลัก

สิ่งที่ต้องคงไว้
- เปิด SCUM client ค้างไว้
- ล็อกอินด้วยบัญชีแอดมิน
- เข้าซิร์ฟเวอร์ที่ถูกตัว
- Windows session ต้องไม่ lock
- admin channel ต้องอยู่ใน state ที่ script ใช้ได้

พฤติกรรมคำสั่งที่พิสูจน์แล้ว
- `#Announce ...`
- `#TeleportToVehicle 50118`
- `#SpawnItem Weapon_M1911 1`
- multi-item
- magazine `StackCount 100`

### จุดส่งของปัจจุบัน
- ใช้รถ `50118` เป็น teleport target default

### ถ้าส่งของไม่เข้า
เช็กตามลำดับ
1. announce ผ่านไหม
2. teleport ผ่านไหม
3. spawn ผ่านไหม
4. item id เป็น canonical หรือไม่

---

## 6. งาน wallet / reward / event

### 6.1 ดู wallet dispute
ใช้ `Audit Center`

filter แนะนำ
- `user`
- `reason`
- `dateFrom/dateTo`

### 6.2 ดู reward claim
ดูได้ใน Audit Center เช่นกัน

เช็ก
- daily
- weekly
- welcome
- wheel

### 6.3 ดู event
เช็ก
- create
- join
- start
- end
- reward payout

---

## 7. Backup / Restore

### ก่อน backup
เช็กก่อนว่า
- ไม่มี migration ค้าง
- worker ไม่กำลังส่งของชุดใหญ่

### backup
ทำจากหน้าแอดมินหรือใช้ flow ในคู่มือหลัก

### restore
ทำเมื่อ
- config พัง
- data พัง
- ต้องย้อน state

หลัง restore ต้อง
1. restart runtime
2. ตรวจ queue
3. ตรวจ audit
4. ตรวจ portal/admin login

---

## 8. คำสั่งเช็กด่วน

### เช็กสถานะระบบ

```bat
pm2 status
```

### ดู log

```bat
pm2 logs scum-bot-local --lines 100
pm2 logs scum-worker-local --lines 100
pm2 logs scum-console-agent-local --lines 100
pm2 logs scum-web-portal-local --lines 100
pm2 logs scum-watcher-local --lines 100
```

### เช็ก config/doctor

```bat
npm run doctor
npm run doctor:topology:prod
npm run doctor:web-standalone:prod
```

### เช็ก readiness/smoke

```bat
npm run readiness:prod
npm run smoke:postdeploy
```

---

## 9. ถ้ามีปัญหาให้ไล่แบบนี้

### 9.1 login ไม่ได้
เช็ก
- cookie secure/origin
- Discord redirect path
- client secret

### 9.2 admin web เปิดได้แต่ข้อมูลไม่อัปเดต
เช็ก
- worker / bot / portal health
- dashboard cards cache
- audit filters

### 9.3 ของไม่เข้า
เช็ก
- queue
- dead-letter
- command log
- SCUM client window
- admin channel
- teleport target

### 9.4 watcher ไม่ขึ้น event
เช็ก
- `SCUM_LOG_PATH`
- webhook secret
- watcher health
- webhook port

---

## 10. สิ่งที่แอดมินไม่ควรทำ

- อย่ารัน SCUM server หลาย instance บน save DB เดียวกัน
- อย่าปล่อย Windows session lock ถ้าใช้ `agent mode`
- อย่าแก้ `.env` แล้วลืม restart runtime
- อย่าใช้ placeholder secrets ใน production
- อย่า retry delivery ซ้ำรัว ๆ โดยไม่ดู command log ก่อน
