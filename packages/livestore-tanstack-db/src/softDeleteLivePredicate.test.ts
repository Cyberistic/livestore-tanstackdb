// @ts-nocheck
import { Schema } from "@livestore/livestore";
import { describe, expect, test } from "bun:test";

import { softDeleteLivePredicate } from "./softDeleteLivePredicate.ts";

const makeSchema = (signatures: Array<{
  name: PropertyKey;
  type: { _tag: string; types?: ReadonlyArray<{ _tag: string }>; members?: ReadonlyArray<{ _tag: string }> };
}>): Schema.Top =>
  ({
    ast: { propertySignatures: signatures },
  }) as unknown as Schema.Top;

const makeNullOrColumn = (name: string) => ({
  name,
  type: {
    _tag: "Union",
    types: [{ _tag: "Literal" }, { _tag: "Declaration" }] as const,
  },
});

describe("softDeleteLivePredicate", () => {
  test("returns true when the configured column is absent", () => {
    const schema = makeSchema([
      { name: "id", type: { _tag: "String" } },
      { name: "title", type: { _tag: "String" } },
    ]);
    const predicate = softDeleteLivePredicate(schema);
    // Every row is live because there's no deletedAt column to check.
    expect(predicate({ id: "1" })).toBe(true);
    expect(predicate({ id: "1", title: "anything" })).toBe(true);
  });

  test("returns true when an alternate 'column' option is not on the schema", () => {
    const schema = makeSchema([{ name: "id", type: { _tag: "String" } }]);
    const predicate = softDeleteLivePredicate(schema, { column: "archivedAt" });
    expect(predicate({ id: "1", archivedAt: "2026-01-01" })).toBe(true);
  });

  test("returns false when the configured column is non-null", () => {
    const schema = makeSchema([
      { name: "id", type: { _tag: "String" } },
      makeNullOrColumn("deletedAt"),
    ]);
    const predicate = softDeleteLivePredicate(schema);
    expect(predicate({ id: "1", deletedAt: "2026-01-01T00:00:00.000Z" })).toBe(false);
    expect(predicate({ id: "1", deletedAt: new Date() })).toBe(false);
  });

  test("returns true when the configured column is null", () => {
    const schema = makeSchema([
      { name: "id", type: { _tag: "String" } },
      makeNullOrColumn("deletedAt"),
    ]);
    const predicate = softDeleteLivePredicate(schema);
    expect(predicate({ id: "1", deletedAt: null })).toBe(true);
  });

  test("returns true when the configured column is undefined", () => {
    const schema = makeSchema([
      { name: "id", type: { _tag: "String" } },
      makeNullOrColumn("deletedAt"),
    ]);
    const predicate = softDeleteLivePredicate(schema);
    expect(predicate({ id: "1" })).toBe(true);
  });

  test("respects the 'column' override", () => {
    const schema = makeSchema([
      { name: "id", type: { _tag: "String" } },
      makeNullOrColumn("archivedAt"),
    ]);
    const predicate = softDeleteLivePredicate(schema, { column: "archivedAt" });
    expect(predicate({ id: "1", archivedAt: "2026-01-01" })).toBe(false);
    expect(predicate({ id: "1", archivedAt: null })).toBe(true);
  });

  test("returns true when the column exists but isn't a NullOr union", () => {
    // `isNullOrDate` rejects non-union types. If somebody hand-builds a
    // struct where `deletedAt` is a plain `Schema.String`, the predicate
    // must default to "everything is live" rather than throwing.
    const schema = makeSchema([
      { name: "id", type: { _tag: "String" } },
      { name: "deletedAt", type: { _tag: "String" } },
    ]);
    const predicate = softDeleteLivePredicate(schema);
    expect(predicate({ id: "1", deletedAt: "any-string" })).toBe(true);
  });
});
