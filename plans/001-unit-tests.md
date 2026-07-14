# Plan 001: Add unit tests to integration packages

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3263a9de..HEAD -- packages/livestore-prisma/src packages/livestore-tanstack-db/src packages/livestore-prisma/package.json packages/livestore-tanstack-db/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `3263a9de`, 2026-07-14
- **Issue**: omit

## Why this matters

The integration packages contain non-trivial, refactor-risky logic: a Prisma generator, schema transforms, mutation classification, event key derivation, and hook internals. Today neither `livestore-prisma` nor `livestore-tanstack-db` has any unit tests (`package.json` only exposes `build` and `typecheck`). Adding a test baseline makes every subsequent refactor and bug fix verifiable and prevents regressions.

## Current state

- `packages/livestore-prisma/package.json` scripts: only `build` and `typecheck`.
- `packages/livestore-tanstack-db/package.json` scripts: only `build` and `typecheck`.
- No `*.test.ts` files exist under `packages/`.
- The SPA example has Playwright E2E tests (`examples/spa/tests/todomvc.spec.ts`), but they do not cover the generator or schema helpers.

Repo convention: the workspace uses `bun`, so the built-in `bun:test` runner is the lightest path. Test files sit next to the module they exercise (e.g., `src/foo.ts` → `src/foo.test.ts`).

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
| --------- | -------------------------------------------------------- | ------------------- |
| Install   | `bun install`                                            | exit 0              |
| Typecheck | `bun run --cwd packages/livestore-prisma typecheck`      | exit 0, no errors   |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0, no errors   |
| Test      | `bun run --cwd packages/livestore-prisma test`           | exit 0, tests pass  |
| Test      | `bun run --cwd packages/livestore-tanstack-db test`      | exit 0, tests pass  |

## Scope

**In scope**:

- `packages/livestore-prisma/package.json` (add `test` script)
- `packages/livestore-tanstack-db/package.json` (add `test` script)
- New test files in `packages/livestore-prisma/src/`
- New test files in `packages/livestore-tanstack-db/src/`

**Out of scope**:

- Example apps (they already have Playwright; do not add example unit tests here).
- Changing the implementation under test.
- CI/GitHub Actions (separate plan).

## Git workflow

- Branch: `advisor/001-unit-tests`
- Commit per logical unit: e.g., `test(livestore-prisma): add generator tests`, `test(livestore-tanstack-db): add mutation classifier tests`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add `test` scripts

In both `packages/livestore-prisma/package.json` and `packages/livestore-tanstack-db/package.json`, add a `test` script that uses `bun test`:

```json
"scripts": {
  "build": "tsc -p tsconfig.build.json",
  "typecheck": "tsc --noEmit",
  "test": "bun test"
}
```

**Verify**: `cat packages/livestore-prisma/package.json | grep -A3 '"scripts"'` contains `"test": "bun test"`. Same for `packages/livestore-tanstack-db/package.json`.

### Step 2: Add tests for `livestore-prisma`

Create tests covering the pure, testable modules:

- `src/getKeyFromSchema.test.ts`
  - Returns `id` when schema has no `fields`.
  - Returns the annotated primary-key field when `ast.isPrimaryKey` is set.
  - Returns a field ending in `Id` when no annotation.
  - Falls back to `id`.
- `src/liveStoreTableSchema.test.ts`
  - Builds a `Schema.Struct` with the correct field types.
  - Maps `date` columns to a string-backed date schema.
  - Marks optional columns as `Schema.optional`.
  - Throws or warns on unknown column types (depends on current behavior; match it).
- `src/standardSchema.test.ts`
  - `toStandardSchemaV1` returns a schema whose `Context` is `never`.
  - `toLiveStoreSchema` accepts the upstream schema without compile error.
- `src/softDeleteLivePredicate.test.ts`
  - Returns `true` for non-object inputs.
  - Returns `false` when `deletedAt`/`archivedAt` are set.
  - Returns `false` when `isDeleted` is `true`.

Use the existing `bun:test` API (`import { describe, test, expect } from "bun:test"`). Keep tests deterministic and do not import React or Vite worker plugins.

**Verify**: `bun run --cwd packages/livestore-prisma test` → all new tests pass, exit 0.

### Step 3: Add tests for `livestore-tanstack-db`

Create tests covering:

- `src/mutations.test.ts` (pure, no React needed)
  - `classifyProcedure("createPost")` → `["insert"]`.
  - `classifyProcedure("postDelete")` → `["delete"]`.
  - `classifyProcedure("updatePost")` → `["update"]`.
  - `classifyProcedure("ownProfile", "profileUpserted")` → `["insert"]`.
  - `classifyProcedure("ownProfile", "profileDeleted")` → `["delete"]`.
  - `classifyProcedure("weirdName")` → `["insert", "update"]`.
- `src/getKeyFromSchema.test.ts`
  - Returns `row => row.id` for an `id` column.
  - Returns the annotated primary-key column.
  - Throws when no usable column exists.
- `src/softDeleteLivePredicate.test.ts`
  - Returns `true` when the configured column is absent.
  - Returns `false` when the configured column is non-null.

Avoid importing `lazyDb.ts`, `useTable.ts`, `useJoinQuery.ts`, or `LiveStoreProvider.tsx` in these unit tests — they pull in React/Vite internals. They can be covered later by E2E or a dedicated React-test-renderer plan.

**Verify**: `bun run --cwd packages/livestore-tanstack-db test` → all new tests pass, exit 0.

### Step 4: Ensure typecheck still passes

**Verify**:

- `bun run --cwd packages/livestore-prisma typecheck` → exit 0
- `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0

## Test plan

- New test files listed above.
- Existing test pattern: none; model after `bun:test` conventions and keep tests next to source.
- Verification: `bun run --cwd packages/livestore-prisma test` and `bun run --cwd packages/livestore-tanstack-db test` both exit 0 with N new tests passing.

## Done criteria

- [ ] `packages/livestore-prisma/package.json` and `packages/livestore-tanstack-db/package.json` have `"test": "bun test"`.
- [ ] `bun run --cwd packages/livestore-prisma test` exits 0 with at least 4 new test files and all passing.
- [ ] `bun run --cwd packages/livestore-tanstack-db test` exits 0 with at least 2 new test files and all passing.
- [ ] `bun run --cwd packages/livestore-prisma typecheck` exits 0.
- [ ] `bun run --cwd packages/livestore-tanstack-db typecheck` exits 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The package.json files already have a `test` script with a different runner (do not overwrite without noting it).
- A test requires importing React or worker plugins to stay deterministic (flag the file; do not add brittle tests).
- Typecheck fails and the fix requires touching implementation code (this plan is test-only).

## Maintenance notes

- These tests are the baseline for plans 002, 004, 006, and 009. Run them before and after any refactor.
- Future changes to `classifyProcedure` rules must update `mutations.test.ts`.
- Future generator output changes must update `liveStoreTableSchema.test.ts` and `getKeyFromSchema.test.ts`.
- Keep tests pure; React hook tests should live in a separate `vitest`/`react-test-renderer` setup if added later.
