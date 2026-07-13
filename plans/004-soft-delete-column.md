# Plan 004: Fix delete handlers to use the configured soft-delete column

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3263a9de..HEAD -- packages/livestore-prisma/src/createLiveStoreDb.ts packages/livestore-tanstack-db/src/useTable.ts packages/livestore-tanstack-db/src/mutations.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: 001-unit-tests
- **Category**: bug
- **Planned at**: commit `3263a9de`, 2026-07-14
- **Issue**: omit

## Why this matters

`createLiveStoreDb` accepts a configurable soft-delete column (`softDeleteColumns` or `events[model].softDeleteColumn`) and generates a `Deleted` event whose schema is `{ id, [softDeleteCol]: Date }`. However, both `useTable` and `mutations.ts` always emit `deletedAt: new Date()`. For models using `archivedAt`, `isDeleted`, or another column name, the event fails schema validation or updates the wrong column.

## Current state

The `Deleted` event schema is dynamic in the factory:

```ts
// packages/livestore-prisma/src/createLiveStoreDb.ts:280-285
if (cfg.includeDeleted !== false && softDeleteCol) {
  const deletedName = `${version}.${modelName}Deleted`;
  events[`${modelPrefix}Deleted`] = Events.synced({
    name: deletedName,
    schema: Schema.Struct({ id: Schema.String, [softDeleteCol]: Schema.Date }),
  });
```

But the delete handlers hardcode `deletedAt`:

```ts
// packages/livestore-tanstack-db/src/useTable.ts:186-193
const makeCommitDelete = (store: Store<any>, name: TableName, events: Record<string, any>) => {
  const e = syncedEventFor(name, events, "Deleted");
  return (row: LiveStoreRow) => {
    store.commit(
      e({
        id: (row as { id: string }).id,
        deletedAt: new Date(),
      } as unknown as Parameters<typeof e>[0]),
    );
  };
};
```

```ts
// packages/livestore-tanstack-db/src/mutations.ts:364-369
commitDelete: (row) => {
  const id = (row as { id: string }).id;
  tryCommit(store, findEvent(events, deleteEventKey), {
    id,
    deletedAt: new Date(),
  });
```

## Commands you will need

| Purpose   | Command                                                  | Expected on success         |
| --------- | -------------------------------------------------------- | --------------------------- |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0                      |
| Test      | `bun run --cwd packages/livestore-tanstack-db test`      | exit 0, including new tests |
| E2E       | `cd examples/spa && bun run test`                        | passes                      |

## Scope

**In scope**:

- `packages/livestore-tanstack-db/src/useTable.ts` (`makeCommitDelete`)
- `packages/livestore-tanstack-db/src/mutations.ts` (`commitDelete` in `createMutations`)
- `packages/livestore-tanstack-db/src/mutations.test.ts` (add tests)
- Optionally `packages/livestore-tanstack-db/src/useTable.test.ts` (add tests)

**Out of scope**:

- `packages/livestore-prisma/src/createLiveStoreDb.ts` (the event schema is already correct).
- `packages/livestore-tanstack-db/src/softDeleteLivePredicate.ts` (reads only; no change needed).
- The SPA example, which uses `deletedAt` and continues to work.

## Git workflow

- Branch: `advisor/004-soft-delete-column`
- Commit: `fix(useTable,mutations): emit configured soft-delete column on delete`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Derive the soft-delete column in `useTable`

In `packages/livestore-tanstack-db/src/useTable.ts`, `makeCommitDelete` needs to know the active soft-delete column. The table schema is already available via `tableSchema` in `getCollection`, and `softDeleteColumnFromSchema` already walks the schema for `/(deleted|archived|removed)/` of `NullOr(...)` type. Alternatively, the `LiveStoreDb` config can carry a `softDeleteColumns` map.

Choose the most reliable source available in `useTable`:

- If the `LiveStoreProvider` context or explicit `liveStore` option carries a `softDeleteColumns` map, use `liveStore.softDeleteColumns?.[name] ?? "deletedAt"`.
- If not, fall back to `softDeleteColumnFromSchema(tableSchema)`.

Update `makeCommitDelete` to accept the column name:

```ts
const makeCommitDelete = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
  softDeleteColumn: string,
) => {
  const e = syncedEventFor(name, events, "Deleted");
  return (row: LiveStoreRow) => {
    store.commit(
      e({
        id: (row as { id: string }).id,
        [softDeleteColumn]: new Date(),
      } as unknown as Parameters<typeof e>[0]),
    );
  };
};
```

Update the call site in `buildCommitCallbacks` to pass the resolved column. For client-document tables, there is no delete event; skip.

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 2: Derive the soft-delete column in `createMutations`

In `packages/livestore-tanstack-db/src/mutations.ts`, `createMutations` receives `events` and `modelName`. It also needs the soft-delete column. Add it to `CreateMutationsConfig`:

```ts
export interface CreateMutationsConfig {
  // ... existing fields ...
  /** Soft-delete column for this model (defaults to `deletedAt`). */
  softDeleteColumn?: string;
}
```

Update `commitDelete`:

```ts
commitDelete: (row) => {
  const id = (row as { id: string }).id;
  const softDeleteColumn = config.softDeleteColumn ?? "deletedAt";
  tryCommit(store, findEvent(events, deleteEventKey), {
    id,
    [softDeleteColumn]: new Date(),
  });
  // ... RPC calls unchanged ...
};
```

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 3: Pass the soft-delete column into `createMutations`

In `packages/livestore-tanstack-db/src/useTable.ts`, inside `getCollection`, resolve the soft-delete column once and pass it to `createMutations` when `rpc?.client` is present.

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 4: Add regression tests

In `packages/livestore-tanstack-db/src/mutations.test.ts`, add a test for `createMutations` with a custom soft-delete column:

```ts
test("commitDelete uses configured soft-delete column", () => {
  const deletedEvent = jest.fn((x) => x);
  const events = { todoDeleted: deletedEvent };
  const store = { commit: jest.fn() } as any;
  const mutations = createMutations({
    store,
    modelName: "Todo",
    events,
    softDeleteColumn: "archivedAt",
  });
  mutations.commitDelete({ id: "1" });
  expect(deletedEvent).toHaveBeenCalledWith(
    expect.objectContaining({ archivedAt: expect.any(Date) }),
  );
});
```

Add a corresponding test in `useTable` test file if one exists.

**Verify**: `bun run --cwd packages/livestore-tanstack-db test` → new tests pass.

## Test plan

- New regression tests in `packages/livestore-tanstack-db/src/mutations.test.ts` for custom soft-delete column.
- Optional regression test in `packages/livestore-tanstack-db/src/useTable.test.ts`.
- Run SPA Playwright tests to confirm `deletedAt` behavior is unchanged.
- Verification: `bun run --cwd packages/livestore-tanstack-db test` exits 0.

## Done criteria

- [ ] `makeCommitDelete` in `useTable.ts` emits the configured soft-delete column, not hardcoded `deletedAt`.
- [ ] `createMutations` in `mutations.ts` accepts and uses a `softDeleteColumn` config, defaulting to `deletedAt`.
- [ ] `getCollection` passes the resolved soft-delete column into `createMutations`.
- [ ] New regression tests exist and pass.
- [ ] `bun run --cwd packages/livestore-tanstack-db typecheck` exits 0.
- [ ] SPA Playwright tests still pass (or the manual `deletedAt` path still works).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The `LiveStoreProvider` context does not expose a `softDeleteColumns` map and `softDeleteColumnFromSchema` cannot be imported into `useTable`.
- Changing the payload shape breaks the `mutations.test.ts` baseline from plan 001.
- The SPA example starts failing deletes with the default `deletedAt` column.

## Maintenance notes

- Future `useTable` refactors should keep the soft-delete column resolution in one place (e.g., in `getCollection`) so both the auto-derived and RPC paths use the same value.
- If plan 006 (deduplicate shared helpers) lands first, the soft-delete column resolution may move to a shared helper; rebase this plan accordingly.
