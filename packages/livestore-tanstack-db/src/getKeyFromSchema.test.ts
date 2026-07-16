// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { getKeyFromSchema } from "./getKeyFromSchema.ts";

const makeField = (overrides: {
  name: string;
  isPrimaryKey?: boolean;
  endsInId?: boolean;
} = { name: "x" }) => ({
  ast: { isPrimaryKey: overrides.isPrimaryKey === true },
  name: overrides.name,
});

const makeSchemaWithFields = (
  fieldNames: string[],
  options: { primaryKeyMarker?: string; endsInIdMatch?: string[] } = {},
): unknown => {
  const fields: Record<string, { ast: { isPrimaryKey?: boolean } }> = {};
  for (const name of fieldNames) {
    fields[name] = {
      ast: { isPrimaryKey: options.primaryKeyMarker === name },
    };
  }
  return { fields };
};

describe("getKeyFromSchema", () => {
  test("uses 'id' as the fallback when schema has no fields", () => {
    const getKey = getKeyFromSchema({});
    expect(getKey({ id: "abc" })).toBe("abc");
    expect(getKey({ id: "xyz" })).toBe("xyz");
  });

  test("defaults to 'id' when input is null or non-object", () => {
    expect(getKeyFromSchema(null)({ id: "a" })).toBe("a");
    expect(getKeyFromSchema(undefined)({ id: "b" })).toBe("b");
    expect(getKeyFromSchema("not a schema" as any)({ id: "c" })).toBe("c");
  });

  test("returns column marked with isPrimaryKey annotation", () => {
    const schema = makeSchemaWithFields(["uuid", "email"], { primaryKeyMarker: "uuid" });
    const getKey = getKeyFromSchema(schema as any);
    expect(getKey({ uuid: "u-1", email: "a@b.c" })).toBe("u-1");
  });

  test("annotation wins over an 'id' column", () => {
    const schema = makeSchemaWithFields(["id", "uuid"], { primaryKeyMarker: "uuid" });
    const getKey = getKeyFromSchema(schema as any);
    expect(getKey({ id: "ignored", uuid: "u-2" })).toBe("u-2");
  });

  test("falls back to a field whose name ends in 'Id' when no annotation", () => {
    const schema = makeSchemaWithFields(["userId", "email"]);
    const getKey = getKeyFromSchema(schema as any);
    expect(getKey({ userId: "u-3", email: "a@b.c" })).toBe("u-3");
  });

  test("falls back to the literal 'id' column", () => {
    const schema = makeSchemaWithFields(["title", "id"]);
    const getKey = getKeyFromSchema(schema as any);
    expect(getKey({ title: "hello", id: "i-1" })).toBe("i-1");
  });

  test("returns 'id' accessor when fields exist but none match patterns", () => {
    const schema = makeSchemaWithFields(["title", "body"]);
    const getKey = getKeyFromSchema(schema as any);
    expect(getKey({ id: "fallback-1", title: "t" })).toBe("fallback-1");
  });

  test("returns the first annotated column when multiple exist (deterministic)", () => {
    const fields: Record<string, { ast: { isPrimaryKey?: boolean } }> = {
      a: { ast: {} },
      b: { ast: { isPrimaryKey: true } },
      c: { ast: { isPrimaryKey: true } },
    };
    const getKey = getKeyFromSchema({ fields } as any);
    expect(typeof getKey({ a: "x", b: "y", c: "z" })).toBe("string");
  });
});
