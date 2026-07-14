# Plan 015: Validate or fallback for unknown Prisma column types

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3263a9de..HEAD -- packages/livestore-prisma/src/liveStoreTableSchema.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: 001-unit-tests
- **Category**: bug
- **Planned at**: commit `3263a9de`, 2026-07-14
- **Issue**: omit

## Why this matters

`buildLiveStoreTableSchema` in `packages/livestore-prisma/src/liveStoreTableSchema.ts` silently skips any column type that is not in the hard-coded `COLUMN_TYPE_TO_SCHEMA` map. If the upstream `prisma-effect-schema-generator` introduces a new column type (e.g., `bigint`, `decimal`, enum variants), the generated LiveStore table schema will omit required columns, leading to validation failures or silent data loss.

## Current state

```ts
// packages/livestore-prisma/src/liveStoreTableSchema.ts:31-49
const COLUMN_TYPE_TO_SCHEMA = {
  string: () => Schema.String,
  number: () => Schema.Number,
  boolean: () => Schema.Boolean,
  date: () => /* ... */,
  bytes: () => Schema.Uint8Array,
  json: () => Schema.Unknown,
  unknown: () => Schema.Unknown,
} as const;

// packages/livestore-prisma/src/liveStoreTableSchema.ts:62-65
for (const col of table.columns) {
  const builder = COLUMN_TYPE_TO_SCHEMA[col.type];
  if (!builder) continue;
  const base = builder();
  fields[col.name] = col.required ? base : Schema.optional(base);
}
```

The `ColumnDescriptor` type currently allows `"string" | "number" | "boolean" | "date" | "json" | "bytes" | "unknown"`, but the upstream generator may emit a value not in this set or the type may be widened in the future.

## Commands you will need

| Purpose   | Command                                                   | Expected on success         |
| --------- | --------------------------------------------------------- | --------------------------- |
| Typecheck | `bun run --cwd packages/livestore-prisma typecheck`       | exit 0                      |
| Test      | `bun run --cwd packages/livestore-prisma test`            | exit 0, including new tests |
| Gen       | `cd examples/tanstack-start-orpc && bunx prisma generate` | exit 0                      |

## Scope

**In scope**:

- `packages/livestore-prisma/src/liveStoreTableSchema.ts`
- `packages/livestore-prisma/src/liveStoreTableSchema.test.ts` (add tests)

**Out of scope**:

- Adding support for every possible Prisma type (only add a safe fallback or explicit error).
- Changing the upstream generator.

## Git workflow

- Branch: `advisor/015-unknown-column-types`
- Commit: `fix(liveStoreTableSchema): throw on unknown column type`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Decide the handling strategy

The safest default is to throw an explicit error when a column type has no builder, so the generator fails fast instead of silently omitting a column. This is a breaking change for any schema that currently relies on the silent-skip behavior, but there is no legitimate use case for dropping required columns.

Alternatively, fall back to `Schema.Unknown` and log a warning. Choose the fail-fast behavior unless the existing tests reveal consumers relying on the fallback.

### Step 2: Implement the validation

Edit `packages/livestore-prisma/src/liveStoreTableSchema.ts`:

```ts
for (const col of table.columns) {
  const builder = COLUMN_TYPE_TO_SCHEMA[col.type];
  if (!builder) {
    throw new Error(
      `liveStoreTableSchema: unsupported column type '${col.type}' for column '${col.name}' in table '${table.name}'. ` +
        `Supported types are: ${Object.keys(COLUMN_TYPE_TO_SCHEMA).join(", ")}.`,
    );
  }
  const base = builder();
  fields[col.name] = col.required ? base : Schema.optional(base);
}
```

If you choose the `Schema.Unknown` fallback instead, replace the throw with:

```ts
const base = Schema.Unknown;
fields[col.name] = col.required ? base : Schema.optional(base);
// optionally log a warning
```

**Verify**: `bun run --cwd packages/livestore-prisma typecheck` → exit 0.

### Step 3: Add regression tests

In `packages/livestore-prisma/src/liveStoreTableSchema.test.ts`, add tests:

```ts
import { describe, test, expect } from "bun:test";
import { buildLiveStoreTableSchema } from "./liveStoreTableSchema.ts";

describe("buildLiveStoreTableSchema", () => {
  test("throws on unknown column type", () => {
    expect(() =>
      buildLiveStoreTableSchema("Todo", {
        name: "todos",
        primaryKey: "id",
        softDelete: null,
        includedInSync: true,
        columns: [
          { name: "id", type: "string", required: true, list: false, unique: false, isEnum: false },
          {
            name: "count",
            type: "bigint",
            required: true,
            list: false,
            unique: false,
            isEnum: false,
          },
        ],
      }),
    ).toThrow(/unsupported column type 'bigint'/);
  });
});
```

If you chose the fallback behavior, assert that the unknown column becomes `Schema.optional(Schema.Unknown)` or similar.

**Verify**: `bun run --cwd packages/livestore-prisma test` → the new tests pass.

### Step 4: Verify generator still works

Run the generator in the TanStack Start example to ensure the current schema still generates successfully.

**Verify**: `cd examples/tanstack-start-orpc && bunx prisma generate` → exit 0.

## Test plan

- New regression test in `packages/livestore-prisma/src/liveStoreTableSchema.test.ts`.
- Run the TanStack Start example generator to confirm existing schemas still pass.

## Done criteria

- [ ] Unknown column types are handled explicitly (throw or fallback to `Schema.Unknown`).
- [ ] A regression test exists and passes.
- [ ] `bun run --cwd packages/livestore-prisma typecheck` exits 0.
- [ ] `bun run --cwd packages/livestore-prisma test` exits 0.
- [ ] The TanStack Start example generator still succeeds.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- Existing schemas in the examples trigger the new error (then the type map needs to be extended before adding the throw).
- The chosen handling strategy conflicts with a documented upstream generator contract.
- The test environment cannot exercise the function without importing Effect runtime internals.

## Maintenance notes

- Future Prisma type support should be added by extending `COLUMN_TYPE_TO_SCHEMA`.
- If new types are added, update `liveStoreTableSchema.test.ts` to cover them.
- Reviewers should verify that the error message includes the column name, table name, and supported types.
