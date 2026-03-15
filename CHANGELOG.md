# Changelog

All notable changes to this project will be documented in this file.

Operator-facing release notes live under `docs/releases/` and are written separately from this changelog.

The release process is automated through GitHub Actions and release tagging.
See `.github/workflows/release.yml` for the source of truth.

## [Unreleased]

- CI verification now publishes workflow-backed status artifacts instead of relying on hardcoded test counts in docs.
- `ci:verify` now runs with a deterministic test-safe env overlay, so local verification no longer depends on the current `.env`.
- Added env profile preparation scripts for development, test, and production.
- Updated test env overlays to use split-runtime topology defaults and stronger non-placeholder admin token values.
- Added local smoke stack automation for clean-room CI installs.
- Added delivery capability matrix, DB migration path notes, ADR, and evidence bundle support per order.
- Extended secret scanning to allow tracked profile example env files while keeping generated split env files and backup files blocked.
- Tightened git hooks so `pre-push` scans the whole repo, not just currently staged files.
