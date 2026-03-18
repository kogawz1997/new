# Product-Ready Gap Matrix

Last updated: `2026-03-18`

This file is a stricter product-readiness overlay, not the same thing as the required backlog in [WORKLIST.md](./WORKLIST.md).

Use it when the question is "what still separates this repo from a harder product-ready bar?" rather than "what still fails the current validation bar?"

## Source Basis

Read this file together with:

- [WORKLIST.md](./WORKLIST.md) for the required backlog against the current repo validation bar
- [../PROJECT_HQ.md](../PROJECT_HQ.md) for the current workstation/runtime truth and explicit "do not claim" lines
- [DATABASE_STRATEGY.md](./DATABASE_STRATEGY.md) for the current `schema-per-tenant` cutover state
- [DELIVERY_NATIVE_PROOF_COVERAGE.md](./DELIVERY_NATIVE_PROOF_COVERAGE.md) for native-proof coverage limits
- [../README.md](../README.md) and [EVIDENCE_MAP_TH.md](./EVIDENCE_MAP_TH.md) for the current evidence surface

The statuses below are intentionally stricter than the repo's current required bar.

## Status Meaning

| Status          | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `Closed`        | Good enough for the current workstation/product baseline described in repo docs |
| `Partial`       | Real foundations exist, but the item is not complete against the stricter bar   |
| `Open`          | Still clearly missing or blocked                                                |
| `Not a blocker` | Valid future work, but not a sensible gate for a first product-ready release    |

## Matrix

| #   | Item                                  | Status          | Gate Before Product-Ready? | Current read                                                                                                                                                                                                       |
| --- | ------------------------------------- | --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Reduce console-agent dependency       | `Partial`       | `Yes`                      | Live console-agent proof, classified health/preflight diagnostics, managed-process auto-restart telemetry, and failover logic exist, but execution still depends on a real Windows session and SCUM client window. |
| 2   | Tenant isolation across the whole app | `Closed`        | `No`                       | The repo/workstation baseline is now `schema-per-tenant`, tenant-aware service paths are routed, and the current workstation has already cut over.                                                                 |
| 3   | Native proof across environments      | `Open`          | `Yes`                      | Representative proof is strong on the current workstation, but second server-configuration and second workstation/runtime coverage are still the one required open backlog item.                                   |
| 4   | Production-grade restore / rollback   | `Partial`       | `Yes`                      | Restore preview, maintenance gates, rollback backup, compatibility handling, post-restore verification, persisted restore status, and regression coverage exist, but the flow is still intentionally controlled rather than fully automated ops recovery. |
| 5   | Centralized config control in admin   | `Partial`       | `Yes`                      | Admin web now exposes a broad env catalog with per-key policy/apply metadata, validation, audit logging, and restart guidance, but it still does not cover every env/config switch.                               |
| 6   | Delivery analytics / metrics          | `Partial`       | `No`                       | Audit, runtime status, and queue visibility exist, but richer per-item/per-server metrics are not fully productized.                                                                                               |
| 7   | Admin operational tools               | `Partial`       | `No`                       | Retry/dead-letter/timeline foundations exist, but the full bulk-retry/selective-resend/stuck-order toolset is not complete.                                                                                        |
| 8   | API / data contract consistency       | `Partial`       | `No`                       | Shared JSON contracts and serialization helpers exist, but the whole product is not yet normalized under one response/error/versioning scheme.                                                                     |
| 9   | Real observability                    | `Partial`       | `No`                       | Health, readiness, doctor, smoke, and admin observability surfaces exist, but full metrics/alert/dashboard posture is still below a mature ops bar.                                                                |
| 10  | Security hardening                    | `Partial`       | `No`                       | DB login, Discord SSO, TOTP 2FA, step-up auth, security events, and secret scanning exist, but broader rate-limit/abuse/rotation coverage is not complete.                                                         |
| 11  | Admin UX polish                       | `Partial`       | `No`                       | Admin web is functional and much more modular, but it is still a large operator-facing surface with room to simplify.                                                                                              |
| 12  | Player portal improvement             | `Partial`       | `No`                       | Wallet, purchases, redeem, profile, and Steam link flows already exist, but product UX/engagement layers are still open.                                                                                           |
| 13  | Deployment simplification             | `Partial`       | `No`                       | Setup helpers, PostgreSQL local scripts, and env scaffolding exist, but onboarding is not yet truly one-click across environments.                                                                                 |
| 14  | Documentation polish                  | `Partial`       | `No`                       | The repo already has architecture docs, evidence docs, live captures, and demo assets, but documentation can still be tighter and easier to operate from.                                                          |
| 15  | Commercial readiness                  | `Partial`       | `No`                       | Tenant/platform/license/subscription primitives exist, but a fully productized billing/onboarding/commercial layer is not yet the repo's strongest claim.                                                          |
| 16  | Performance tuning                    | `Not a blocker` | `No`                       | Important later, but not the right gate for first product-ready status at the current scale.                                                                                                                       |
| 17  | Smarter queue system                  | `Partial`       | `No`                       | Queue/retry/dead-letter foundations already exist; priority/adaptive behavior is additive hardening, not a launch gate.                                                                                            |
| 18  | Plugin / extension system             | `Not a blocker` | `No`                       | Nice for long-term extensibility, not a rational first product-ready gate.                                                                                                                                         |
| 19  | Multi-region readiness                | `Not a blocker` | `No`                       | This is scale/distribution work, not a first product-ready baseline requirement.                                                                                                                                   |
| 20  | Automation / self-healing             | `Not a blocker` | `No`                       | Valuable advanced ops work, but beyond a sane first release gate.                                                                                                                                                  |

## Recommended Gating Set

If the goal is a hard but still practical product-ready bar, the real gating set is:

1. reduce console-agent dependency enough that failures are classified, recoverable, and operationally manageable
2. prove native delivery verification on more than one environment
3. harden restore / rollback into something another operator can run confidently
4. centralize more runtime/config control into admin without unsafe manual `.env` editing

## Notable Calls

- Item `2` is marked `Closed` because the repo/workstation bar is already cut over to `schema-per-tenant`. If you raise the bar to "all environments proven" or "all tiers run database-per-tenant", that becomes a separate hardening track, not an undisputed current blocker.
- Item `3` is marked `Open` because it is still the only required open backlog item in [WORKLIST.md](./WORKLIST.md), even before applying the stricter product-ready overlay.
- Items `16` to `20` stay out of the gating set because they are scale/extension maturity work, not the minimum bar for a first product-ready claim.

## Important Distinction

- [WORKLIST.md](./WORKLIST.md) is the source of truth for what is still open against the current repo validation bar.
- This file is the source of truth for the stricter "product-ready" discussion only.
