# Plan 009: Replace `require()` with dynamic `import()` in `LiveStoreDevtoolsBridge`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3263a9de..HEAD -- packages/livestore-tanstack-db/src/devtools/LiveStoreDevtoolsBridge.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: 001-unit-tests
- **Category**: tech-debt
- **Planned at**: commit `3263a9de`, 2026-07-14
- **Issue**: omit

## Why this matters

`packages/livestore-tanstack-db/src/devtools/LiveStoreDevtoolsBridge.tsx` uses CommonJS `require("@livestore/adapter-web")` to resolve a fallback store. The package is ESM (`"type": "module"`), so `require` is undefined in strict ESM environments such as Node, Bun, and some bundlers. This causes the fallback path to crash when the `store` prop is omitted.

## Current state

```tsx
// packages/livestore-tanstack-db/src/devtools/LiveStoreDevtoolsBridge.tsx:52-65
const resolveAppStore = (): Store<any> | null => {
  if (_fallbackStore !== undefined) return _fallbackStore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@livestore/adapter-web") as {
      getOrCreateAppStore?: () => Store<any> | null;
    };
    _fallbackStore =
      typeof mod.getOrCreateAppStore === "function" ? mod.getOrCreateAppStore() : null;
  } catch {
    _fallbackStore = null;
  }
  return _fallbackStore;
};
```

The package is ESM (`packages/livestore-tanstack-db/package.json:5` sets `"type": "module"`).

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
| --------- | -------------------------------------------------------- | ------------------- |
| Typecheck | `bun run --cwd packages/livestore-tanstack-db typecheck` | exit 0              |
| Test      | `bun run --cwd packages/livestore-tanstack-db test`      | exit 0              |
| Build     | `bun run --cwd packages/livestore-tanstack-db build`     | exit 0              |

## Scope

**In scope**:

- `packages/livestore-tanstack-db/src/devtools/LiveStoreDevtoolsBridge.tsx`
- `packages/livestore-tanstack-db/src/devtools/LiveStoreDevtoolsBridge.test.tsx` (optional, create if feasible)

**Out of scope**:

- `packages/livestore-tanstack-db/src/devtools/bridge.ts` (no changes needed).
- Adding `@livestore/adapter-web` as a dependency or peer dependency (this plan keeps the lazy import).

## Git workflow

- Branch: `advisor/009-devtools-require`
- Commit: `fix(devtools): use dynamic import instead of require in ESM package`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Convert `resolveAppStore` to async

`import()` is async, so `resolveAppStore` must return a `Promise` and the caller must await it. Since `LiveStoreDevtoolsBridge` is a React component, use `useEffect` to load the fallback store.

Replace the current implementation with:

```tsx
const resolveAppStore = async (): Promise<Store<any> | null> => {
  if (_fallbackStore !== undefined) return _fallbackStore;
  try {
    const mod = await import("@livestore/adapter-web");
    _fallbackStore =
      typeof mod.getOrCreateAppStore === "function" ? mod.getOrCreateAppStore() : null;
  } catch {
    _fallbackStore = null;
  }
  return _fallbackStore;
};
```

Then in the component:

```tsx
export const LiveStoreDevtoolsBridge: React.FC<LiveStoreDevtoolsBridgeProps> = ({
  store,
  collections,
}) => {
  const [resolvedStore, setResolvedStore] = useState<Store<any> | null>(store ?? null);

  useEffect(() => {
    if (store) return;
    let cancelled = false;
    resolveAppStore().then((s) => {
      if (!cancelled) setResolvedStore(s);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  useLiveStoreDevtoolsBridge(resolvedStore);

  useEffect(() => {
    if (!collections) return;
    for (const [id, collection] of Object.entries(collections)) {
      registerCollection(id, collection);
    }
  }, [collections]);

  return null;
};
```

Add `useState` to the `react` import at the top of the file.

**Verify**: `bun run --cwd packages/livestore-tanstack-db typecheck` → exit 0.

### Step 2: Add a regression test (optional)

If the test environment can render a React component, add a test that renders `<LiveStoreDevtoolsBridge />` without the `store` prop and verifies it does not throw. If not, add a simple test that mocks `import("@livestore/adapter-web")` and calls `resolveAppStore`.

**Verify**: `bun run --cwd packages/livestore-tanstack-db test` → exit 0.

### Step 3: Build the package

**Verify**: `bun run --cwd packages/livestore-tanstack-db build` → exit 0.

## Test plan

- New unit test for `resolveAppStore` if feasible.
- Build the package to ensure the ESM output is valid.
- Verification: `bun run --cwd packages/livestore-tanstack-db typecheck` and `bun run --cwd packages/livestore-tanstack-db build` both exit 0.

## Done criteria

- [ ] `LiveStoreDevtoolsBridge.tsx` no longer contains `require("@livestore/adapter-web")`.
- [ ] The component uses `import()` and `useState`/`useEffect` for the fallback store.
- [ ] `bun run --cwd packages/livestore-tanstack-db typecheck` exits 0.
- [ ] `bun run --cwd packages/livestore-tanstack-db build` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The component cannot be made async-loading because `useLiveStoreDevtoolsBridge` expects a synchronous store.
- The test environment cannot render the component and a unit test for `resolveAppStore` is not possible without mocking ESM imports.

## Maintenance notes

- Future changes to this component should preserve the lazy import to avoid a hard dependency on `@livestore/adapter-web`.
- If the package later wants to support a synchronous fallback, consider adding `@livestore/adapter-web` as an optional peer dependency and importing it at the top level.
- Reviewers should check that the ESM build output does not contain `require` calls.
