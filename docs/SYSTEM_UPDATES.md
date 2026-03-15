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
- `ADMIN_WEB_STEP_UP_ENABLED=true` and `ADMIN_WEB_STEP_UP_TTL_MINUTES=15` are now set explicitly in the live root `.env`
- PM2 runtime `bot / worker / watcher / web / console-agent` is online together and `npm run smoke:postdeploy` now passes against the live split-origin stack
- `ADMIN_WEB_SSO_DISCORD_ENABLED=true` and admin OAuth start now redirects to Discord successfully on the live split-origin stack
- Added [ADMIN_SSO_ROLE_MAPPING_TH.md](./ADMIN_SSO_ROLE_MAPPING_TH.md) plus `npm run admin:sso:roles` to export owner/admin/mod Discord role ids for admin SSO
- Added fallback support for `ADMIN_WEB_SSO_DISCORD_*_ROLE_NAMES` so production can map `Owner / Admin / Moderator` explicitly even when role ids are not yet exported
- Added agent circuit breaker + RCon failover strategy for delivery runtime hardening
- Added admin security event trail, session revoke flow, step-up auth for sensitive mutations, and role-matrix API
- Added dedicated Auth + Security admin panel, modal-based step-up confirmation, auth explorer filters/search, and migration/rollback/restore policy docs with schema-version compatibility evidence
- Added tenant-scoped analytics/reconcile guards for public platform API isolation
- Added admin recent request trace logging for production debugging
- Added restore preview token / expiry / schema guard as an extra restore safety layer
- Moved admin web bootstrap out of the Discord-ready path so `/admin` stays available during Discord login degradation
- Added [REPO_STRUCTURE_TH.md](./REPO_STRUCTURE_TH.md) and [LIMITATIONS_AND_SLA_TH.md](./LIMITATIONS_AND_SLA_TH.md) for long-term handoff quality
- Added workflow-backed CI badge/release badge, Node matrix testing, clean-room install checks, and verification artifacts instead of hardcoded test counts
- Added env profile overlays plus `npm run env:prepare:*` for development/test/production separation
- Added `npm run smoke:local-ci`, `npm run ci:verify`, and local smoke stack automation for clean-room verification
- Added package metadata cleanup, commercial license file, release-please workflow, and changelog automation baseline
- Added delivery evidence bundle persistence per order plus a dedicated capability matrix for `RCON` vs `agent mode`
- Hardened `ci:verify` to inject deterministic test-safe env values instead of depending on the developer machine `.env`
- Updated tracked env profile examples so topology doctor passes cleanly in `test` profile without bot/worker overlap
- Removed hardcoded test totals from operations docs and pointed status references at CI artifacts instead
- Extended secret scanning allowlist for tracked `development/test` env examples while still blocking generated `.env.*.split` and backup paths
