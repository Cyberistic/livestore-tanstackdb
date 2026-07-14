# Plan 002: Fix client-document insert event in `useTable`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f2cd0dbd..HEAD -- packages/livestore-tanstack-db/src/useTable.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001-unit-tests
- **Category**: bug
- **Planned at**: commit `f2cd0dbd`, 2026-07-14
- **Issue**: omit

## Why this matters

`useTable` supports client documents (tables created via `createLiveStoreDb({ clientDocuments: { ... } })`). Their event is named `${name}Set`, not `${name}Created`. The current code still routes client-document inserts through `makeCommitInsert`, which looks up a non-existent `Created` event and throws. This makes `useTable`/`useCrud` unusable on client documents.

## Current state

`packages/livestore-tanstack-db/src/useTable.ts` has a helper `clientDocSetEventFor` that already knows how to find the `Set` event:

```ts
// packages/livestore-tanstack-db/src/useTable.ts:86-94
const clientDocSetEventFor = (name: TableName, events: Record<string, any>) => {
  const e = (events as Record<string, any>)[`${name}Set`];
  if (!e) {
    throw new Error(
      `useTable(${name}): no \`${name}Set\` event found in schema. Did the table get declared as a client document in createLiveStoreDb?`,
    );
  }
  return e;
};
```

But `buildCommitCallbacks` returns the wrong handler for inserts:

```ts
// packages/livestore-tanstack-db/src/useTable.ts:262-269
// Client document — has a `set` event
return {
  commitInsert: makeCommitInsert(store, name, events),
  commitUpdate: (input: { id: string; changes: Record<string, unknown> }) => {
    store.commit(clientDocSetEventFor(name, events)({ id: input.id, value: input.changes }));
  },
};
```

`makeCommitInsert` resolves `syncedEventFor(name, events, "Created")`, which fails for client documents.

## Commands you will need

| Purpose   | Command                                                  | Expected on success        |
| --------- | -------------------------------------------------------- | -------------------------- |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0                     |
| Test      | `bun run --cwd packages/livestore-tanstack-db test`      | exit 0, including new test |
| E2E       | `cd examples/spa && bun run test` (optional)             | passes (if run)            |

## Scope

**In scope**:

- `packages/livestore-tanstack-db/src/useTable.ts` (`buildCommitCallbacks` client-document branch)
- `packages/livestore-tanstack-db/src/useTable.test.ts` (create)

**Out of scope**:

- `createLiveStoreDb` client-document setup.
- The SPA example's direct `events.uiStateSet` usage in `Footer.tsx`.
- Any change to the `useCrud` API surface.

## Git workflow

- Branch: `advisor/002-client-doc-insert`
- Commit: `fix(useTable): use Set event for client-document inserts`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a client-document insert helper

Add a helper next to `clientDocSetEventFor` in `packages/livestore-tanstack-db/src/useTable.ts` that builds the correct insert commit for a client document. The LiveStore client-document `set` event expects the document payload; the row passed by TanStack DB (`mutation.modified`) is the document value.

```ts
const makeCommitClientDocInsert = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
) => {
  const setEvent = clientDocSetEventFor(name, events);
  return (row: LiveStoreRow) => {
    store.commit(setEvent(row));
  };
};
```

If the `set` event signature requires `{ id, value }` instead of the raw row, adjust the payload shape to match. Verify by inspecting the type of `setEvent` and the runtime behavior of the SPA `uiState` client document.

### Step 2: Wire the helper in `buildCommitCallbacks`

Replace the client-document `commitInsert`:

```ts
// packages/livestore-tanstack-db/src/useTable.ts:262-269
// Client document — has a `set` event
return {
  commitInsert: makeCommitClientDocInsert(store, name, events),
  commitUpdate: (input: { id: string; changes: Record<string, unknown> }) => {
    store.commit(clientDocSetEventFor(name, events)({ id: input.id, value: input.changes }));
  },
};
```

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 3: Add a regression test

Create `packages/livestore-tanstack-db/src/useTable.commitCallbacks.test.ts` that tests `buildCommitCallbacks` indirectly. Since `buildCommitCallbacks` is not exported, export it for testing only (or test via a small React-free harness).

Recommended minimal test:

```ts
import { describe, test, expect, jest } from "bun:test";
import { buildCommitCallbacks } from "./useTable.ts";

describe("buildCommitCallbacks", () => {
  test("client document insert uses Set event", () => {
    const setEvent = jest.fn((x) => x);
    const store = { commit: jest.fn((x) => x) } as any;
    const events = { uiStateSet: setEvent };
    const callbacks = buildCommitCallbacks(store, "uiState", events);
    callbacks.commitInsert({ filter: "all" });
    expect(setEvent).toHaveBeenCalledWith({ filter: "all" });
    expect(store.commit).toHaveBeenCalled();
  });
});
```

If `setEvent` expects `{ id, value }`, update the assertion to match the correct payload shape and document it in the test.

**Verify**: `bun run --cwd packages/livestore-tanstack-db test` → the new test passes.

## Test plan

- New unit test: `packages/livestore-tanstack-db/src/useTable.commitCallbacks.test.ts`.
- Optional: add a Playwright test in `examples/spa/tests/todomvc.spec.ts` that creates a new todo (exercises the synced table path) and toggles the footer filter (exercises client-document reads, but not inserts).
- Verification: `bun run --cwd packages/livestore-tanstack-db test` exits 0.

## Done criteria

- [ ] `buildCommitCallbacks` returns a client-document `commitInsert` that uses the `${name}Set` event.
- [ ] `bun run --cwd packages/livestore-tanstack-db typecheck` exits 0.
- [ ] A new regression test exists and passes.
- [ ] No files outside `useTable.ts` and the new test file are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The `set` event payload shape does not match either a raw row or `{ id, value }` (the fix is unclear).
- Changing `buildCommitCallbacks` requires changing `createLiveStoreDb` or the SPA example to keep typecheck passing.
- The `useTable.ts` file no longer matches the "Current state" excerpt after drift.

## Maintenance notes

- If a future plan changes the client-document event shape in `createLiveStoreDb`, this helper must be updated too.
- Reviewers should confirm the test covers both the existing synced-table insert path and the new client-document insert path.
