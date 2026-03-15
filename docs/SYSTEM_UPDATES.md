# SYSTEM_UPDATES

อัปเดตรอบล่าสุดถูกรวมไว้ที่ [PROJECT_HQ.md](../PROJECT_HQ.md) เป็นหลัก แต่รอบ `2026-03-15` มีงาน platform foundation เพิ่มสำคัญดังนี้:

- Billing / subscription foundation พร้อม plan catalog และ subscription records
- License / legal docs พร้อม `Terms`, `Privacy`, `Subscription Policy`
- Multi-tenant foundation พร้อม tenant, reseller-ready shape, API key scope และ webhook endpoint
- Anti-abuse + delivery reconcile พร้อม monitoring cycle และ alert integration
- Monitoring + alerting ฝั่ง platform พร้อม auto backup และ agent stale/version drift alert
- One-click / bootstrap path เพิ่ม `npm run platform:bootstrap:win` และ schema upgrade fallback
- Public API / webhook สำหรับ tenant integration และ agent heartbeat
- Permission catalog ระดับ scope สำหรับ platform API
- Agent version management ผ่าน heartbeat + minimumVersion
- Marketplace / analytics / landing / trial / showcase route สำหรับ demo และ commercial flow

ลิงก์ที่เกี่ยวข้อง:

- สถานะรวมและ roadmap: [PROJECT_HQ.md](../PROJECT_HQ.md)
- เช็กลิสต์ go-live: [GO_LIVE_CHECKLIST_TH.md](./GO_LIVE_CHECKLIST_TH.md)
- เอกสารโชว์งาน: [SHOWCASE_TH.md](./SHOWCASE_TH.md)
- Terms: [LEGAL_TERMS_TH.md](./LEGAL_TERMS_TH.md)
- Privacy: [PRIVACY_POLICY_TH.md](./PRIVACY_POLICY_TH.md)
- Subscription Policy: [SUBSCRIPTION_POLICY_TH.md](./SUBSCRIPTION_POLICY_TH.md)

Production rollout update:

- Admin portal now targets `https://admin.genz.noah-dns.online/admin`
- Player portal now targets `https://player.genz.noah-dns.online`
- `ADMIN_WEB_2FA_ENABLED=true` and `ADMIN_WEB_2FA_SECRET` are now set in the live root `.env`
- PM2 runtime `bot / worker / watcher / web / console-agent` is online together and `npm run smoke:postdeploy` now passes against the live split-origin stack
- `ADMIN_WEB_SSO_DISCORD_ENABLED=true` and admin OAuth start now redirects to Discord successfully on the live split-origin stack
