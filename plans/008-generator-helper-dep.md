# Plan 008: Move `@prisma/generator-helper` to `livestore-prisma` dependencies

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3c97473c..HEAD -- packages/livestore-prisma/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `3c97473c`, 2026-07-14
- **Issue**: omit

## Why this matters

`packages/livestore-prisma/prisma-livestore-generator.cjs` dynamically imports `dist/generator.js`, and `src/generator.ts` imports `@prisma/generator-helper` at runtime. Prisma generators run in the consumer's environment when `prisma generate` is invoked, so the dependency must be installed for the package to work. Keeping it in `devDependencies` means consumers may not get it installed.

## Current state

`packages/livestore-prisma/package.json` lists `@prisma/generator-helper` under `devDependencies` (line 28). It is imported at `src/generator.ts:1` and required transitively by the binary `prisma-livestore-generator.cjs:5`.

## Commands you will need

| Purpose   | Command                                                   | Expected on success |
| --------- | --------------------------------------------------------- | ------------------- |
| Typecheck | `bun run --cwd packages/livestore-prisma typecheck`       | exit 0              |
| Typecheck | `bun run --cwd examples/tanstack-start-orpc typecheck`    | exit 0              |
| Gen       | `cd examples/tanstack-start-orpc && bunx prisma generate` | exit 0              |

## Scope

**In scope**:

- `packages/livestore-prisma/package.json`

**Out of scope**:

- The generator source code.
- The SPA example (it does not currently use the generator).

## Git workflow

- Branch: `advisor/008-generator-helper-dep`
- Commit: `fix(livestore-prisma): move @prisma/generator-helper to dependencies`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Move the dependency

Edit `packages/livestore-prisma/package.json`:

- Remove `@prisma/generator-helper` from `devDependencies`.
- Add it to `dependencies` (same version, `^7.0.0` or the current version).

The file should end up with:

```json
"dependencies": {
  "@tanstack/react-db": "^0.1.0",
  "@prisma/generator-helper": "^7.0.0"
},
"devDependencies": {
  "@cloudflare/workers-types": "^4.0.0",
  "@types/node": "^26.1.1",
  "@types/react": "^19.0.0",
  "effect": "^3.21.0",
  "typescript": "^5.4.0"
}
```

Wait — plan 007 removes `@tanstack/react-db` and `@types/react`. If plan 007 lands first, the dependencies block will be different. Apply this plan to the current state, or rebase after plan 007. Regardless, ensure `@prisma/generator-helper` ends up in `dependencies` and not `devDependencies`.

**Verify**: `cat packages/livestore-prisma/package.json` shows `@prisma/generator-helper` in `dependencies`.

### Step 2: Reinstall and verify the generator

Run `bun install` from the workspace root.

**Verify**:

- `bun install` exits 0.
- `bun run --cwd packages/livestore-prisma typecheck` exits 0.
- `cd examples/tanstack-start-orpc && bunx prisma generate` exits 0 and the generated file `prisma/generated/livestore/index.ts` is created/updated.

## Test plan

- No new unit tests needed.
- Integration test: run the generator in `examples/tanstack-start-orpc`.
- Verification: `grep -A2 '"dependencies"' packages/livestore-prisma/package.json | grep '@prisma/generator-helper'` returns a match.

## Done criteria

- [ ] `@prisma/generator-helper` is in `dependencies` of `packages/livestore-prisma/package.json`.
- [ ] `bun install` exits 0 and the lockfile is updated.
- [ ] `bun run --cwd packages/livestore-prisma typecheck` exits 0.
- [ ] `cd examples/tanstack-start-orpc && bunx prisma generate` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The generator fails to run after the move because of a version mismatch with the installed `prisma` CLI.
- `@prisma/generator-helper` is already in `dependencies` (drift; stop and report).

## Maintenance notes

- Any future generator dependency must also be in `dependencies`, not `devDependencies`.
- Reviewers should verify package boundaries: runtime/generator deps go in `dependencies`; build-only types go in `devDependencies`.
