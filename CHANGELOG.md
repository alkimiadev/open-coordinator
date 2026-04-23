# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [2.0.0] - 2026-04-23

### Changed
- **Breaking**: Replaced 10 separate tools with a single `worktree` tool using `{action, args}` registry pattern
- **Breaking**: Removed `worktree_mode` gate — all operations work without opt-in
- **Breaking**: Package renamed from `@alkimiadev/open-coordinator` to `@alkdev/open-coordinator`
- **Breaking**: License changed from MIT to (MIT OR Apache-2.0)
- Role-based access control: coordinator sessions get all operations, implementation (spawned) sessions get only `notify`, `current`, `status`, `help`
- Role detection is automatic from `state.json` — no manual configuration needed
- Spawned sessions now inherit coordinator's model via `promptAsync`, with explicit override support
- Spawned sessions now set `parentID` in `session.create()` for native OpenCode hierarchy tracking
- Operation hints updated from old multi-tool syntax to new `worktree({action: ...})` syntax

### Added
- `AGENTS.md` with role-based operation reference
- `src/registry.ts` — Handler type, operation registry, role detection, router
- `tests/registry.test.ts` — 18 tests for routing, role access, and handler behavior
- Dual license files (MIT and Apache-2.0)
- `publishConfig.access: "public"` for npm publishing

### Removed
- `src/mode.ts` and `tests/mode.test.ts` — mode gate deleted entirely
- 9 separate tool definitions consolidated into one `worktree` tool

## [1.0.0] - 2026-04-09

### Changed
- Forked from [open-trees](https://github.com/0xSero/open-trees) by 0xSero
- Renamed package to `@alkdev/open-coordinator`
- Updated repository URLs to alkimiadev/open-coordinator

## [1.0.1] - 2026-01-08

### Changed
- Patch release following 1.0.0.

## [1.0.0] - 2026-01-08

### Added
- Stable 1.0.0 release with full worktree management capabilities.
- Published to npm for public installation.
- Comprehensive documentation and brand assets.
- Native `/worktree on|off` slash command for toggling worktree mode and emitting help.

### Changed
- Optional command examples now use `/worktree on` and `/worktree off` instead of `/worktree-on`.

## [0.2.0] - 2026-01-07

### Added
- Worktree mode gating with four primary tools for a tighter UX.
- Worktree mode state tracking and tests for mode persistence.
- CI workflow, Dependabot configuration, and contributor docs.
- Bun security scanner configuration and npm audit in CI.

### Changed
- Default worktree root is now `<repo>/.worktrees/<branch>`.
- Session creation reuses existing worktrees when available.
- Documentation updated for the new tool surface and workflows.

### Fixed
- Safer command quoting for displayed git commands.
- Improved error handling and performance in worktree dashboard/status flows.

## [0.1.0] - 2025-12-15

### Added
- Initial Open Trees release.
