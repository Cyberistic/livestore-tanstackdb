# Plan 011: Update transitive vulnerable dependencies

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3263a9de..HEAD -- bun.lock package.json examples/spa/package.json examples/tanstack-start-orpc/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `3263a9de`, 2026-07-14
- **Issue**: omit

## Why this matters

`bun audit` reports high-severity advisories in transitive dependencies used by the examples: `vite` (arbitrary file read, `server.fs.deny` bypass), `undici` (WebSocket DoS, TLS bypass, memory exhaustion), `wrangler` (command injection), and `ws` (memory exhaustion DoS). These affect the dev server, the LiveStore sync transport, and the deploy pipeline.

## Current state

Running `bun audit` at the workspace root shows advisories including:

- `vite` >=7.0.0 <=7.3.4 — multiple high-severity path traversal / arbitrary file read issues.
- `undici` >=7.0.0 <7.18.2 — multiple high-severity WebSocket / TLS issues.
- `wrangler` >=4.0.0 <4.59.1 — high-severity command injection.
- `ws` >=8.0.0 <8.20.1 — high-severity memory exhaustion DoS.

These are transitive dependencies, not direct dependencies of the integration packages. The examples pin `vite: 7.3.1`, `wrangler: 4.42.2`, etc.

## Commands you will need

| Purpose   | Command                              | Expected on success                        |
| --------- | ------------------------------------ | ------------------------------------------ |
| Audit     | `bun audit`                          | shows fewer or no high-severity advisories |
| Typecheck | `bun run typecheck` (workspace root) | exit 0                                     |
| Build     | `bun run build` (workspace root)     | exit 0                                     |
| Gen       | `bun run gen` (workspace root)       | exit 0                                     |
| E2E       | `cd examples/spa && bun run test`    | passes                                     |

## Scope

**In scope**:

- `bun.lock`
- `examples/spa/package.json` (update pinned deps to patched versions)
- `examples/tanstack-start-orpc/package.json` (update pinned deps to patched versions)
- Root `package.json` if it has relevant dependencies

**Out of scope**:

- `packages/livestore-prisma/package.json` and `packages/livestore-tanstack-db/package.json` (they have very few direct dependencies; only update if they are affected).
- Any source code changes.

## Git workflow

- Branch: `advisor/011-update-dependencies`
- Commit: `chore(examples): update vulnerable dependencies`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Identify patched versions

Run `bun audit` and note the patched version ranges from each advisory:

- `vite`: update to a version above the affected range (e.g., `7.3.5` or `8.x` if compatible).
- `undici`: update to `7.18.2` or later.
- `wrangler`: update to `4.59.1` or later.
- `ws`: update to `8.20.1` or later.

Use the exact patched versions that satisfy the example's other constraints. If a major bump is required, stop and report.

### Step 2: Update direct dependency pins in example package.json files

For each affected package, update the pinned version in both `examples/spa/package.json` and `examples/tanstack-start-orpc/package.json` to the patched version. If the package is only transitive (e.g., `undici` is a dependency of `@livestore/livestore`), try `bun update` first to see if it resolves the transitive tree.

**Verify**: `cat examples/spa/package.json | grep -E '"vite"|"wrangler"|"ws"'` shows the new versions. Same for `examples/tanstack-start-orpc/package.json`.

### Step 3: Run `bun update` and `bun install`

From the workspace root:

```bash
bun update
bun install
```

**Verify**: `bun install` exits 0 and `bun.lock` is updated.

### Step 4: Re-audit and verify the app still works

**Verify**:

- `bun audit` shows no high-severity advisories affecting the examples (some low/moderate may remain; report those left).
- `bun run typecheck` exits 0.
- `bun run build` exits 0.
- `bun run gen` exits 0.
- `cd examples/spa && bun run test` passes (if the environment supports it).

## Test plan

- No new unit tests.
- Integration test: run `bun run gen` and the SPA Playwright suite.
- Verification: `bun audit` no longer reports high-severity advisories for the cited packages.

## Done criteria

- [ ] `bun audit` shows no high-severity advisories for `vite`, `undici`, `wrangler`, or `ws` in the examples.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run build` exits 0.
- [ ] `bun run gen` exits 0.
- [ ] SPA Playwright tests pass (if run).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- Updating a dependency requires a major-version bump that breaks the example build or typecheck.
- A patched version is not available for one of the affected packages.
- `bun update` introduces new type errors that require source changes.

## Maintenance notes

- Add `bun audit` to CI once a CI workflow is added (separate plan).
- Reviewers should verify the lockfile diff is limited to the affected packages.
- If an advisory cannot be patched due to upstream constraints, document it in the plan's README status as blocked.
