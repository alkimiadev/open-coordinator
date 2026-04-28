# AAR: Coordinate-24-Tasks Session (2026-04-27)

**Session**: `ses_231df0170ffenxrz64oBNMiTuU`
**AAR Message**: `msg_dd0c83c35001uPUjyqEF7Y3LPk`
**Outcome**: 27 implementation tasks + 2 reviews completed in ~5h wall time using 24 parallel worktrees with 3-7 concurrent agents.

## What Went Right

- **Worktree isolation** — Each agent got a clean branch, committed independently, and the coordinator merged sequentially. No agent stepped on another's files during implementation.
- **Parallelism** — Consistently ran 3-7 agents concurrently. The spawn + notify pattern worked as designed.
- **Agent role system** — Implementation agents committed and notified; reviewers wrote reports. Role differentiation functioned correctly.
- **Async coordination model** — Agents reported completion via `worktree notify`, and the coordinator merged on receipt.

## What Went Wrong

### 1. State file staleness (Bug)

The coordinator's `state.json` accumulates entries when worktrees are created via `spawn`, but **cleanup is not automatic**. When running `worktree cleanup remove`, the git worktree is deleted but the state entry persists.

**Impact**:
- `worktree sessions` showed 8+ stale entries from a different project (residual from process cwd bug)
- `worktree dashboard` showed ghost worktrees no longer on disk
- Manual `state.json` surgery was required to clear stale entries

**Root cause**: `cleanup remove` calls `removeWorktree()` (git worktree remove) but never calls `removeSessionMappings()`.

### 2. Remote branches not cleaned up after merge (Gap)

After merging 24 branches into main, all `origin/wt/*` branches still existed on the remote. `cleanup remove` deletes the local worktree and branch, but doesn't push-delete the remote branch.

**Impact**: 24 stale remote branches creating noise and cognitive load.

**Root cause**: No remote branch handling exists anywhere in the codebase. No `git push --delete`, no `git fetch --prune`.

### 3. Session state not cleaned up after completion (Gap)

After agents complete and notify, their session entries remain in `state.json` indefinitely. No lifecycle status exists on entries.

**Impact**: When tracking 5-7 concurrent agents, filtering out 20+ stale entries is error-prone and makes monitoring unreliable.

**Root cause**: `WorktreeSessionEntry` has no `status`, `completedAt`, or result field.

### 4. Merge conflicts in shared test files (Friction)

Three generations had conflicts in `test/schema.test.ts` and `src/graph/construction.ts` because parallel agents all added code to the same files.

**Impact**: Required manual conflict resolution. Not a tool bug, but indicates missing merge tooling.

### 5. Process CWD bug (Fixed)

The server process cwd was picked up instead of the session's project cwd, causing the first spawn to create a worktree in the wrong repo.

### 6. Abort doesn't clean up (Bug — discovered in code audit)

`abort` only calls `ctx.client.session.abort()`. It doesn't remove the worktree, delete the branch, or clean the state entry.

### 7. Local branch orphaned after removal (Bug — discovered in code audit)

`removeWorktree()` runs `git worktree remove` but never runs `git branch -d`. After cleanup, the local branch is orphaned.

### 8. Race condition in state.json writes (Robustness — discovered in code audit)

`storeSessionMapping()` does read-modify-write with no locking. Concurrent spawns can lose entries.

### 9. Partial failure leaves orphaned worktrees (Robustness — discovered in code audit)

If session creation fails after worktree creation succeeds, no rollback happens.

### 10. Detection metrics lost on restart (Robustness — discovered in code audit)

`sessionMetrics` is an in-memory Map lost on process restart.

---

## Improvement Roadmap

### P0: Fix state corruption bugs

These make monitoring unreliable and leave artifacts behind.

| # | Change | Files |
|---|--------|-------|
| 1 | `cleanup remove` should call `removeSessionMappings()` after removing worktree | `registry.ts` (cleanup handler), `worktree.ts` (removeWorktree) |
| 2 | `cleanup remove` should delete the local branch (`git branch -d` or `-D` with force) | `worktree.ts` |
| 3 | `abort` should invoke cleanup logic: remove worktree, delete branch, remove state entry | `registry.ts` (abort handler) |

### P1: Remote branch cleanup

| # | Change | Files |
|---|--------|-------|
| 4 | Add `--remote` flag to `cleanup remove` that also runs `git push origin --delete <branch>` | `registry.ts`, `worktree.ts` |
| 5 | Add `cleanup merged` action that finds all fully-merged `wt/*` branches and cleans up local + remote + state | New operation in `registry.ts`, new function in `worktree.ts` |

### P2: Session lifecycle tracking

| # | Change | Files |
|---|--------|-------|
| 6 | Add `status` field to `WorktreeSessionEntry` (`active`, `completed`, `failed`, `aborted`) | `state.ts` |
| 7 | Add `completedAt` timestamp field | `state.ts` |
| 8 | Add `--status` filter to `sessions` operation | `registry.ts`, `worktree-dashboard.ts` |
| 9 | Update status on lifecycle events (spawn→active, notify blocking→failed, abort→aborted, explicit complete→completed) | Multiple handlers |

### P3: Startup reconciliation

| # | Change | Files |
|---|--------|-------|
| 10 | Add `reconcile()` that prunes state entries whose worktree paths don't exist or whose sessions no longer exist | `state.ts`, called from `index.ts` startup |
| 11 | Run reconciliation on plugin startup | `index.ts` |

### P4: Merge helper

| # | Change | Files |
|---|--------|-------|
| 12 | Add `merge` operation: auto-stash if dirty, checkout target, merge branch, stash-pop, optionally delete branch/remote | New operation in `registry.ts`, new function in `worktree.ts` |

### P5: Robustness

| # | Change | Files |
|---|--------|-------|
| 13 | Add file locking for `state.json` writes (atomic write via temp+rename) | `state.ts` |
| 14 | Add rollback to `spawnWorktrees` — if session creation fails, clean up the already-created worktree and branch | `worktree-spawn.ts` |
| 15 | Persist detection metrics to disk or state.json | `detection/metrics.ts` |

---

## Implementation Status

All P0-P4 items and P5 items 13-14 have been implemented:

| Commit | Description |
|--------|-------------|
| `4fde12a` | docs: add AAR and improvement roadmap |
| `b0a9cd6` | fix: cleanup remove and abort now clean up state entries and local branches (P0) |
| `67c1a04` | feat: add remote branch cleanup and merged branch batch cleanup (P1) |
| `be21a9a` | feat: add session lifecycle tracking with status, completedAt, and filter (P2) |
| `f2b81f4` | feat: add startup reconciliation to prune stale state entries (P3) |
| `69d4d2b` | feat: add merge operation for worktree branches (P4) |
| *(latest)* | feat: atomic state writes and spawn rollback on failure (P5 items 13-14) |

Remaining: P5 item 15 (persist detection metrics) — lower priority, can be addressed in a future iteration.