# Plan 013: Align TypeScript versions across the workspace

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3263a9de..HEAD -- packages/livestore-prisma/package.json packages/livestore-tanstack-db/package.json examples/spa/package.json examples/tanstack-start-orpc/package.json bun.lock`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: dependencies
- **Planned at**: commit `3263a9de`, 2026-07-14
- **Issue**: omit

## Why this matters

The integration packages pin `typescript ^5.4.0` while the examples pin `typescript 6.0.3`. This means the packages and examples are type-checked with different compiler versions and lib surfaces, which can hide latent type errors or cause incompatible declarations. Aligning to a single stable TypeScript 5.x line ensures consistent type checking across the workspace.

## Current state

- `packages/livestore-prisma/package.json:32`: `"typescript": "^5.4.0"`
- `packages/livestore-tanstack-db/package.json:35`: `"typescript": "^5.4.0"`
- `examples/spa/package.json:58`: `"typescript": "6.0.3"`
- `examples/tanstack-start-orpc/package.json:51`: `"typescript": "6.0.3"`

TypeScript 6.0.3 is a pre-release/nightly line. The workspace should use a stable 5.x release.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
| --------- | -------------------------------------------------------- | ------------------- |
| Install   | `bun install`                                            | exit 0              |
| Typecheck | `bun run typecheck` (workspace root)                     | exit 0              |
| Typecheck | `bun run --cwd packages/livestore-prisma typecheck`      | exit 0              |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0              |
| Typecheck | `bun run --cwd examples/spa typecheck`                   | exit 0              |
| Typecheck | `bun run --cwd examples/tanstack-start-orpc typecheck`   | exit 0              |

## Scope

**In scope**:

- `packages/livestore-prisma/package.json`
- `packages/livestore-tanstack-db/package.json`
- `examples/spa/package.json`
- `examples/tanstack-start-orpc/package.json`
- `bun.lock`

**Out of scope**:

- Any source code changes (only fix type errors if they are exposed by the alignment and are trivial).
- Major TypeScript version upgrades beyond the current stable 5.x line.

## Git workflow

- Branch: `advisor/013-align-typescript`
- Commit: `chore(workspace): align TypeScript versions to 5.x`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Choose a single stable TypeScript version

Pick a recent stable 5.x version that is available and satisfies all packages. `^5.7.0` or `^5.8.0` is a reasonable choice. Avoid `^6.0.0` unless the workspace explicitly wants to track TS 6 previews.

### Step 2: Update all package.json files

Change the `typescript` field in all four package.json files to the same version, e.g.:

```json
"typescript": "^5.7.0"
```

**Verify**: `grep '"typescript"' packages/livestore-prisma/package.json packages/livestore-tanstack-db/package.json examples/spa/package.json examples/tanstack-start-orpc/package.json` shows the same version everywhere.

### Step 3: Reinstall and typecheck

```bash
bun install
bun run typecheck
```

**Verify**: `bun install` exits 0 and `bun run typecheck` exits 0.

### Step 4: Fix any newly exposed type errors

If the alignment exposes type errors that were hidden by the 6.0.3 compiler, fix them only if they are trivial and directly related to the version difference. For non-trivial errors, stop and report.

**Verify**: All four package typechecks still exit 0.

## Test plan

- No new tests needed.
- Verification: `bun run typecheck` exits 0 for each workspace package and example.

## Done criteria

- [ ] All four package.json files use the same `typescript` version.
- [ ] `bun install` exits 0 and the lockfile is updated.
- [ ] `bun run typecheck` exits 0 for the workspace root.
- [ ] Each individual package and example typecheck exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- Aligning TypeScript versions exposes non-trivial type errors in the examples or packages.
- The chosen stable version is incompatible with a required dependency (e.g., a package requires TypeScript 6 previews).
- `bun install` fails due to peer-dependency conflicts.

## Maintenance notes

- Future TypeScript upgrades should be done across the whole workspace at once.
- Consider using a single `typescript` dependency at the workspace root if the monorepo setup supports it.
- Reviewers should verify that the lockfile only changes the TypeScript resolution and does not accidentally upgrade unrelated packages.
