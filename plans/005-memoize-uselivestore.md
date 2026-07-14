# Plan 005: Memoize `useLiveStore` return value

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fd32d525..HEAD -- packages/livestore-tanstack-db/src/useTable.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: 001-unit-tests
- **Category**: perf
- **Planned at**: commit `fd32d525`, 2026-07-14
- **Issue**: omit

## Why this matters

`useLiveStore` in `packages/livestore-tanstack-db/src/useTable.ts` returns a new object literal on every render. That object is used as a dependency in `useMemo` inside `useTable`, `useTables`, and `useJoinQuery`, so those hooks re-compute on every render even though the underlying store, tables, and events have not changed. This wastes work and can trigger extra query re-evaluations.

## Current state

`useLiveStore` is defined at `packages/livestore-tanstack-db/src/useTable.ts:52-64`:

```ts
const useLiveStore = (): UseTableLiveStore | null => {
  const config = useLiveStoreConfig();
  if (!config) return null;
  return {
    ...(config.schema as unknown as UseTableLiveStore),
    oRPC: config.oRPC,
  };
};
```

It returns a fresh object every time. `useTable` then includes it in a `useMemo` dependency array (`packages/livestore-tanstack-db/src/useTable.ts:548-560`), and `useTables` and `useJoinQuery` do the same.

The repo's React convention is functional components with hooks; memoization is done via `useMemo` and `useCallback` from `react`.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
| --------- | -------------------------------------------------------- | ------------------- |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0              |
| Test      | `bun run --cwd packages/livestore-tanstack-db test`      | exit 0              |
| E2E       | `cd examples/spa && bun run test`                        | passes              |

## Scope

**In scope**:

- `packages/livestore-tanstack-db/src/useTable.ts` (refactor `useLiveStore` to be stable or decompose dependencies)

**Out of scope**:

- `packages/livestore-tanstack-db/src/useTables.ts` (does not exist; `useTables` is in `useTable.ts` and will benefit from the fix).
- `packages/livestore-tanstack-db/src/useJoinQuery.ts` (benefits indirectly; do not change its logic).
- Any change to the `LiveStoreProvider` context shape.

## Git workflow

- Branch: `advisor/005-memoize-uselivestore`
- Commit: `perf(useTable): memoize liveStore runtime object`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Make `useLiveStore` return a stable object

Refactor `useLiveStore` to return the same object reference when `config.schema` and `config.oRPC` are unchanged. The simplest approach is to use `useMemo` inside `useLiveStore`:

```ts
import { useMemo } from "react";

const useLiveStore = (): UseTableLiveStore | null => {
  const config = useLiveStoreConfig();
  return useMemo(() => {
    if (!config) return null;
    return {
      ...(config.schema as unknown as UseTableLiveStore),
      oRPC: config.oRPC,
    };
  }, [config?.schema, config?.oRPC]);
};
```

Make sure `useMemo` is imported at the top of the file (it already is).

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 2: Update `useTable` dependency arrays to use stable primitives

In `useTable` and `useTables`, the `useMemo` currently depends on the entire `liveStore` object. Replace the dependency array with stable primitive values so the memoization is not sensitive to object identity:

Current `useTable`:

```ts
const collection = useMemo(
  () => getCollection(name, { ...resolvedOptions, liveStore }),
  [
    liveStore,
    name,
    resolvedOptions.where,
    resolvedOptions.rpc,
    resolvedOptions.commitInsert,
    resolvedOptions.commitBulkInsert,
    resolvedOptions.commitUpdate,
    resolvedOptions.commitDelete,
  ],
);
```

Replace `liveStore` in the dependency array with `liveStore.store, liveStore.tables, liveStore.events, liveStore.schema, liveStore.oRPC` (or whichever fields are actually read). Since `liveStore` is now stable from Step 1, you could also keep `liveStore` in the array and still get the benefit; however, using primitives makes the intent clearer and avoids surprises if the context provider later returns a new object.

Apply the same change to `useTables`.

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 3: Add a regression test

Create `packages/livestore-tanstack-db/src/useTable.memoization.test.ts` using `@testing-library/react-hooks` or `react-test-renderer` if available. If not, use a simple render-counter pattern:

```ts
import { describe, test, expect } from "bun:test";
import { renderHook } from "@testing-library/react";
import { LiveStoreProvider } from "./LiveStoreProvider.tsx";
import { useTable } from "./useTable.ts";

describe("useTable memoization", () => {
  test("getCollection is not re-invoked when only the render count changes", () => {
    const store = { storeId: "test", commit: () => {}, subscribe: () => () => {} } as any;
    const tables = {} as any;
    const events = {} as any;
    const schema = {} as any;
    let collectionCount = 0;
    const wrapper = ({ children }) =>
      React.createElement(
        LiveStoreProvider,
        { schema: { store, tables, events, schema } },
        children,
      );
    const { rerender } = renderHook(
      () => useTable("Todo", { noContext: true, liveStore: { store, tables, events, schema } }),
      { wrapper },
    );
    rerender();
    expect(collectionCount).toBe(1); // adjust to actual counting mechanism
  });
});
```

If adding a React test renderer is too much for this plan, add a simpler unit test that verifies `useMemo` is used in `useLiveStore` by inspecting the source (not ideal but acceptable). Better: skip the unit test and rely on the SPA Playwright test to show no regression.

**Verify**: `bun run --cwd packages/livestore-tanstack-db test` → exit 0.

## Test plan

- Add a unit test for `useLiveStore` stability if the test environment supports React hooks; otherwise rely on the SPA E2E suite.
- Run `cd examples/spa && bun run test` to confirm no functional regression.

## Done criteria

- [ ] `useLiveStore` returns a memoized/stabilized object.
- [ ] `useTable` and `useTables` dependency arrays do not depend on the unstable `liveStore` identity.
- [ ] `bun run --cwd packages/livestore-tanstack-db typecheck` exits 0.
- [ ] SPA Playwright tests still pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- `useMemo` is not already imported in `useTable.ts` and adding it causes a circular import.
- The `LiveStoreProvider` context shape changes between renders in a way that makes `useMemo` unstable.
- Refactoring `useJoinQuery` dependencies is required to make typecheck pass.

## Maintenance notes

- Future changes to `useLiveStore` should preserve object stability.
- If `LiveStoreProvider` starts exposing additional mutable fields, this memoization strategy may need to include them.
- Reviewers should verify that `useMemo` dependency arrays include the actual primitives read by `getCollection`.
