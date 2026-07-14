# Plan 007: Remove unused React dependencies from `livestore-prisma`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 51c881c4..HEAD -- packages/livestore-prisma/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `51c881c4`, 2026-07-14
- **Issue**: omit

## Why this matters

`livestore-prisma` is a Prisma generator + `createLiveStoreDb` factory. No source file in the package imports `react` or `@tanstack/react-db`. Declaring those dependencies forces non-React consumers to install React and creates unnecessary peer-pressure and version-conflict risk. The React surface belongs in `livestore-tanstack-db`.

## Current state

`packages/livestore-prisma/package.json` declares:

- `@tanstack/react-db` in `dependencies` (line 24)
- `@types/react` in `devDependencies` (line 30)
- `react` in `peerDependencies` (line 38)

No file under `packages/livestore-prisma/src/` imports from `react` or `@tanstack/react-db`.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
| --------- | -------------------------------------------------------- | ------------------- |
| Typecheck | `bun run --cwd packages/livestore-prisma typecheck`      | exit 0              |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0              |
| Typecheck | `bun run --cwd examples/spa typecheck`                   | exit 0              |
| Typecheck | `bun run --cwd examples/tanstack-start-orpc typecheck`   | exit 0              |
| Gen       | `bun run gen` (workspace root)                           | exit 0              |

## Scope

**In scope**:

- `packages/livestore-prisma/package.json`

**Out of scope**:

- `packages/livestore-tanstack-db/package.json` (it legitimately uses React and `@tanstack/react-db`).
- Any source file.
- README updates (covered by plan 012/013 if needed).

## Git workflow

- Branch: `advisor/007-remove-react-deps`
- Commit: `chore(livestore-prisma): remove unused React dependencies`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Remove unused deps from `livestore-prisma/package.json`

Edit `packages/livestore-prisma/package.json`:

- Remove `@tanstack/react-db` from `dependencies`.
- Remove `@types/react` from `devDependencies`.
- Remove `react` from `peerDependencies`.
- Remove the `peerDependenciesMeta` entry for `react`.

**Verify**: `cat packages/livestore-prisma/package.json` no longer contains `@tanstack/react-db`, `@types/react`, or `react` in any dependency block.

### Step 2: Reinstall and typecheck

Run `bun install` from the workspace root to update the lockfile.

**Verify**:

- `bun install` exits 0.
- `bun run --cwd packages/livestore-prisma typecheck` exits 0.
- `bun run --cwd packages/livestore-tanstack-db typecheck` exits 0.
- `bun run --cwd examples/spa typecheck` exits 0.
- `bun run --cwd examples/tanstack-start-orpc typecheck` exits 0.

### Step 3: Run generation

**Verify**: `bun run gen` exits 0 and the generated files in both examples still typecheck.

## Test plan

- No new tests needed (this is a dependency-only change).
- Run `bun run gen` and the example typechecks as the integration test.
- Verification: `grep -E "(@tanstack/react-db|@types/react|\"react\")" packages/livestore-prisma/package.json` returns no matches.

## Done criteria

- [ ] `packages/livestore-prisma/package.json` no longer lists `@tanstack/react-db`, `@types/react`, or `react`.
- [ ] `bun install` exits 0 and the lockfile is updated.
- [ ] All package and example typechecks pass.
- [ ] `bun run gen` still succeeds.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- A source file under `packages/livestore-prisma/src/` actually imports `react` or `@tanstack/react-db` (then the finding is wrong and the file needs a different fix).
- Removing `react` from peer deps breaks `livestore-tanstack-db` or an example.
- `bun install` fails due to lockfile conflicts.

## Maintenance notes

- Future additions to `livestore-prisma` should not import React. If React is needed, the code belongs in `livestore-tanstack-db`.
- Reviewers should check that the package description (plan 008) and exports remain consistent with the actual package boundary.
