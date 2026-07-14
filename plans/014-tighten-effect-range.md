# Plan 014: Tighten the `effect` peer dependency range

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6bb90c87..HEAD -- packages/livestore-prisma/package.json packages/livestore-tanstack-db/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dependencies
- **Planned at**: commit `6bb90c87`, 2026-07-14
- **Issue**: omit

## Why this matters

Both integration packages declare `effect` as a peer dependency with the range `^3.0.0 || ^4.0.0`. The examples and `@livestore/livestore` 0.4.0 are pinned to `effect 3.21.4`. A consumer with effect 4.x would satisfy the peer but likely fail at runtime because the LiveStore ecosystem is built against effect 3.x. Tightening the range to `^3.0.0` prevents invalid installs.

## Current state

- `packages/livestore-prisma/package.json:37`: `"effect": "^3.0.0 || ^4.0.0"`
- `packages/livestore-tanstack-db/package.json:40`: `"effect": "^3.0.0 || ^4.0.0"`
- Examples pin `effect: 3.21.4`.
- `@livestore/livestore` 0.4.0 and its transitive packages use effect 3.x.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
| --------- | -------------------------------------------------------- | ------------------- |
| Install   | `bun install`                                            | exit 0              |
| Typecheck | `bun run typecheck` (workspace root)                     | exit 0              |
| Typecheck | `bun run --cwd packages/livestore-prisma typecheck`      | exit 0              |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0              |

## Scope

**In scope**:

- `packages/livestore-prisma/package.json`
- `packages/livestore-tanstack-db/package.json`

**Out of scope**:

- Example package.json files (they already pin 3.21.4).
- Any source code.
- Upgrading to effect 4.x (separate, larger effort).

## Git workflow

- Branch: `advisor/014-tighten-effect-range`
- Commit: `chore(packages): restrict effect peer dependency to ^3.0.0`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Update the effect peer range in both integration packages

Edit both files to change:

```json
"effect": "^3.0.0 || ^4.0.0"
```

to:

```json
"effect": "^3.0.0"
```

**Verify**: `grep '"effect"' packages/livestore-prisma/package.json packages/livestore-tanstack-db/package.json` shows `^3.0.0` only.

### Step 2: Reinstall and typecheck

Run `bun install` from the workspace root.

**Verify**:

- `bun install` exits 0.
- `bun run typecheck` exits 0.
- Individual package typechecks exit 0.

## Test plan

- No new tests needed.
- Verification: `grep` confirms the range is `^3.0.0` and all typechecks pass.

## Done criteria

- [ ] `packages/livestore-prisma/package.json` has `effect: ^3.0.0` in peer dependencies.
- [ ] `packages/livestore-tanstack-db/package.json` has `effect: ^3.0.0` in peer dependencies.
- [ ] `bun install` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- A package or example actually requires effect 4.x to compile.
- `bun install` fails because an installed dependency declares `effect: ^4.0.0` as a peer.

## Maintenance notes

- When the workspace is ready to upgrade to effect 4.x, this range can be widened again after verifying `@livestore/livestore` and all transitive packages are compatible.
- Reviewers should confirm the range is consistent with the pinned effect version in the examples.
