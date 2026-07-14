# Plan 012: Clean stale build artifacts in `livestore-prisma/dist`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f2cd0dbd..HEAD -- packages/livestore-prisma/dist packages/livestore-prisma/package.json packages/livestore-prisma/tsconfig.build.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `f2cd0dbd`, 2026-07-14
- **Issue**: omit

## Why this matters

`packages/livestore-prisma/dist` contains files such as `lazyDb.js`, `liveStoreCollection.js`, `LiveStoreProvider.js`, `useDb.js`, `useTable.js`, and `dateStrings.js` that do not have corresponding source files in `packages/livestore-prisma/src`. If the package is published, these stale artifacts will ship and may be imported by consumers, causing runtime/type mismatches.

## Current state

`packages/livestore-prisma/dist` currently has 25 entries. Source files under `packages/livestore-prisma/src` are only 8 files. The extra files are from earlier iterations of the package before it was split into `livestore-prisma` and `livestore-tanstack-db`.

The build script in `packages/livestore-prisma/package.json` is `"build": "tsc -p tsconfig.build.json"`, which emits into `./dist` but does not clean stale files first.

## Commands you will need

| Purpose   | Command                                                | Expected on success |
| --------- | ------------------------------------------------------ | ------------------- |
| Build     | `bun run --cwd packages/livestore-prisma build`        | exit 0              |
| Typecheck | `bun run --cwd packages/livestore-prisma typecheck`    | exit 0              |
| Typecheck | `bun run --cwd examples/spa typecheck`                 | exit 0              |
| Typecheck | `bun run --cwd examples/tanstack-start-orpc typecheck` | exit 0              |

## Scope

**In scope**:

- `packages/livestore-prisma/package.json` (update `build` script to clean `dist`)
- `packages/livestore-prisma/dist` (delete and regenerate)
- `packages/livestore-prisma/tsconfig.build.json` (verify `outDir` is `./dist`)

**Out of scope**:

- Any source file under `packages/livestore-prisma/src/`.
- `packages/livestore-tanstack-db/dist` (review separately if needed).
- The published npm package (this plan prepares the build; publishing is separate).

## Git workflow

- Branch: `advisor/012-clean-dist`
- Commit: `build(livestore-prisma): clean dist before build to remove stale artifacts`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Update the build script to clean `dist` before building

Edit `packages/livestore-prisma/package.json`:

```json
"scripts": {
  "build": "rm -rf dist && tsc -p tsconfig.build.json",
  "typecheck": "tsc --noEmit"
}
```

Use a cross-platform deletion if the package needs to build on Windows (e.g., `node -e "require('fs').rmSync('dist', { recursive: true, force: true })"` instead of `rm -rf`). For the bun-based workspace, `rm -rf` is acceptable.

**Verify**: `cat packages/livestore-prisma/package.json` shows the updated build script.

### Step 2: Delete and rebuild `dist`

Run the updated build script:

```bash
bun run --cwd packages/livestore-prisma build
```

**Verify**: The command exits 0 and `packages/livestore-prisma/dist` contains only files matching the current source files (`createLiveStoreDb.*`, `generator.*`, `getKeyFromSchema.*`, `index.*`, `liveStoreTableSchema.*`, `softDeleteLivePredicate.*`, `standardSchema.*`, `types.*`).

### Step 3: Verify consumers still typecheck

**Verify**:

- `bun run --cwd examples/spa typecheck` exits 0.
- `bun run --cwd examples/tanstack-start-orpc typecheck` exits 0.

## Test plan

- No new tests needed.
- Verify by listing `dist` after build: `ls packages/livestore-prisma/dist` should not contain `lazyDb.*`, `liveStoreCollection.*`, `LiveStoreProvider.*`, `useDb.*`, `useTable.*`, or `dateStrings.*`.

## Done criteria

- [ ] `packages/livestore-prisma/package.json` build script deletes `dist` before compiling.
- [ ] After running `bun run --cwd packages/livestore-prisma build`, `dist` contains only files emitted from current source files.
- [ ] Both example apps still typecheck.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- An example imports one of the stale `dist` files by path (then the stale API needs to be migrated first).
- Deleting `dist` causes the build to fail because `tsconfig.build.json` expects pre-existing output.
- The build script change breaks Windows builds and a cross-platform alternative is required.

## Maintenance notes

- Future builds will automatically clean `dist`, so this issue will not recur.
- If `livestore-tanstack-db/dist` has similar stale files, apply the same pattern there in a follow-up plan.
- Reviewers should verify the dist listing after build to ensure no stale files remain.
