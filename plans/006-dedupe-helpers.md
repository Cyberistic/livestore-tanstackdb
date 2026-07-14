# Plan 006: Deduplicate shared schema helpers and types

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f2cd0dbd..HEAD -- packages/livestore-prisma/src/types.ts packages/livestore-prisma/src/getKeyFromSchema.ts packages/livestore-prisma/src/standardSchema.ts packages/livestore-prisma/src/softDeleteLivePredicate.ts packages/livestore-tanstack-db/src/types.ts packages/livestore-tanstack-db/src/getKeyFromSchema.ts packages/livestore-tanstack-db/src/standardSchema.ts packages/livestore-tanstack-db/src/softDeleteLivePredicate.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 001-unit-tests
- **Category**: tech-debt
- **Planned at**: commit `f2cd0dbd`, 2026-07-14
- **Issue**: omit

## Why this matters

`livestore-prisma` and `livestore-tanstack-db` both define near-identical copies of `ColumnDescriptor`, `TableDescriptor`, `PrimaryKeyColumns`, `SoftDeleteColumns`, `Tables`, `getKeyFromSchema`, `standardSchema`, and `softDeleteLivePredicate`. The copies have already diverged slightly (e.g., `getKeyFromSchema` returns `string | null` in one and a function in the other). This forces every schema fix to be applied twice and increases the risk of inconsistent behavior.

## Current state

Duplicated files:

- `packages/livestore-prisma/src/types.ts` vs `packages/livestore-tanstack-db/src/types.ts`
- `packages/livestore-prisma/src/getKeyFromSchema.ts` vs `packages/livestore-tanstack-db/src/getKeyFromSchema.ts`
- `packages/livestore-prisma/src/standardSchema.ts` vs `packages/livestore-tanstack-db/src/standardSchema.ts`
- `packages/livestore-prisma/src/softDeleteLivePredicate.ts` vs `packages/livestore-tanstack-db/src/softDeleteLivePredicate.ts`

`livestore-prisma` is a lower-level package (generator + `createLiveStoreDb`). `livestore-tanstack-db` is the React/TanStack DB consumer. The clean dependency direction is: `livestore-prisma` owns the shared introspection types and helpers, and `livestore-tanstack-db` imports/re-exports them. `livestore-prisma` already has no React dependency, so this does not add coupling.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
| --------- | -------------------------------------------------------- | ------------------- |
| Typecheck | `bun run --cwd packages/livestore-prisma typecheck`      | exit 0              |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0              |
| Test      | `bun run --cwd packages/livestore-prisma test`           | exit 0              |
| Test      | `bun run --cwd packages/livestore-tanstack-db test`      | exit 0              |
| Gen       | `bun run gen` (from workspace root)                      | exit 0              |

## Scope

**In scope**:

- `packages/livestore-prisma/src/types.ts` (keep as canonical source, add any missing fields from `livestore-tanstack-db`)
- `packages/livestore-prisma/src/getKeyFromSchema.ts` (keep canonical version)
- `packages/livestore-prisma/src/standardSchema.ts` (keep canonical version)
- `packages/livestore-prisma/src/softDeleteLivePredicate.ts` (keep canonical version)
- `packages/livestore-tanstack-db/src/types.ts` (replace with re-exports)
- `packages/livestore-tanstack-db/src/getKeyFromSchema.ts` (replace with re-export or wrapper)
- `packages/livestore-tanstack-db/src/standardSchema.ts` (replace with re-export or wrapper)
- `packages/livestore-tanstack-db/src/softDeleteLivePredicate.ts` (replace with re-export or wrapper)
- `packages/livestore-prisma/src/index.ts` (add public re-exports)
- `packages/livestore-tanstack-db/src/index.ts` (add re-exports from `livestore-prisma`)

**Out of scope**:

- Any change to the logic of these helpers (this is a consolidation, not a rewrite).
- Any change to the generator binary.
- Removing `livestore-prisma` from `livestore-tanstack-db` deps (that is already the case; if not, see plan 007).

## Git workflow

- Branch: `advisor/006-dedupe-helpers`
- Commits:
  - `refactor(livestore-prisma): export shared schema helpers from package index`
  - `refactor(livestore-tanstack-db): consume shared helpers from livestore-prisma`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Reconcile the canonical types in `livestore-prisma`

Compare `packages/livestore-prisma/src/types.ts` with `packages/livestore-tanstack-db/src/types.ts`. Merge any fields present only in the latter (e.g., the comment in `SoftDeleteColumns`) into the `livestore-prisma` version. The public shape must remain identical so consumers are unaffected.

**Verify**: `bun run --cwd packages/livestore-prisma typecheck` → exit 0.

### Step 2: Reconcile the canonical helpers in `livestore-prisma`

Compare the two implementations of each helper:

- `getKeyFromSchema`: `livestore-prisma` returns `string | null`; `livestore-tanstack-db` returns `(row) => string`. Decide on the canonical shape. Since `livestore-prisma` is the lower-level package, keep the `string | null` version and add a thin `getKeyFromSchema` wrapper in `livestore-tanstack-db` that returns the accessor function. Alternatively, keep both signatures in `livestore-prisma` (`getKeyFromSchema` and `getKeyFromSchemaAsAccessor`).
- `standardSchema`: Keep the `livestore-prisma` version as canonical. It already handles `Schema.standardSchemaV1` and `toLiveStoreSchema`.
- `softDeleteLivePredicate`: `livestore-prisma` is a plain `(row) => boolean` over `deletedAt`/`archivedAt`/`isDeleted`. `livestore-tanstack-db` is generic over `TRow` and takes a schema and options. Keep the `livestore-tanstack-db` version as the more flexible one, or keep both and re-export from `livestore-prisma`.

Whichever direction you choose, ensure the public API of `livestore-prisma` and `livestore-tanstack-db` does not change (same exported names, compatible signatures).

**Verify**: `bun run --cwd packages/livestore-prisma typecheck` → exit 0.

### Step 3: Re-export from `livestore-prisma/src/index.ts`

Add public re-exports for the shared items:

```ts
export { getKeyFromSchema } from "./getKeyFromSchema.ts";
export { softDeleteLivePredicate } from "./softDeleteLivePredicate.ts";
export { toStandardSchemaV1, toLiveStoreSchema } from "./standardSchema.ts";
export type {
  ColumnDescriptor,
  TableDescriptor,
  PrimaryKeyColumns,
  SoftDeleteColumns,
  Tables,
} from "./types.ts";
```

**Verify**: `bun run --cwd packages/livestore-prisma typecheck` → exit 0.

### Step 4: Replace duplicated files in `livestore-tanstack-db`

In `livestore-tanstack-db`:

- Update `src/types.ts` to re-export from `livestore-prisma`:
  ```ts
  export type {
    ColumnDescriptor,
    TableDescriptor,
    PrimaryKeyColumns,
    SoftDeleteColumns,
    Tables,
  } from "livestore-prisma";
  ```
- Update `src/getKeyFromSchema.ts` to either re-export or wrap the `livestore-prisma` version. If the signatures differ, add a wrapper that preserves the existing `livestore-tanstack-db` API.
- Update `src/standardSchema.ts` to re-export from `livestore-prisma`.
- Update `src/softDeleteLivePredicate.ts` to re-export from `livestore-prisma` (or keep a wrapper if the API differs).

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 5: Update `livestore-tanstack-db/src/index.ts` if needed

Ensure the public exports of `livestore-tanstack-db` still include `ColumnDescriptor`, `TableDescriptor`, etc., either by re-exporting from `livestore-prisma` directly or through the local wrapper files.

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 6: Run tests and full generation

**Verify**:

- `bun run --cwd packages/livestore-prisma test` → exit 0
- `bun run --cwd packages/livestore-tanstack-db test` → exit 0
- `bun run gen` (workspace root) → exit 0

## Test plan

- The unit tests from plan 001 should still pass for both packages.
- Add a test in `packages/livestore-tanstack-db/src/types.test.ts` that verifies `ColumnDescriptor` is re-exported from `livestore-prisma` (e.g., import both and assert they are the same type).
- Run `bun run gen` to ensure the example still generates correctly.

## Done criteria

- [ ] No duplicate definitions of `ColumnDescriptor`, `TableDescriptor`, `PrimaryKeyColumns`, `SoftDeleteColumns`, or `Tables` remain.
- [ ] `livestore-tanstack-db` imports the shared helpers/types from `livestore-prisma`.
- [ ] `bun run --cwd packages/livestore-prisma typecheck` and `bun run --cwd packages/livestore-tanstack-db typecheck` both exit 0.
- [ ] Both package test suites exit 0.
- [ ] `bun run gen` exits 0 and the generated examples still typecheck.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The helper signatures differ in a way that cannot be reconciled without breaking the public API.
- `livestore-tanstack-db` does not already depend on `livestore-prisma` (add the dependency first; see plan 007).
- Removing the duplicated files causes the SPA or TanStack Start example to fail generation.

## Maintenance notes

- Future changes to schema introspection types should be made in `livestore-prisma/src/types.ts` only.
- If `livestore-tanstack-db` needs a TanStack DB-specific variant of a helper, keep it in `livestore-tanstack-db` and do not duplicate the generic version.
- Reviewers should confirm that no downstream consumer imports the removed local files by path.
