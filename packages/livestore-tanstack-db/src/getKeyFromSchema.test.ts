// @ts-nocheck
import { Schema } from "@livestore/livestore";
import { describe, expect, test } from "bun:test";

import { getKeyFromSchema } from "./getKeyFromSchema.ts";

const makeSchema = (signatures: Array<{
  name: PropertyKey;
  type: { _tag: string };
  isOptional?: boolean;
  annotations?: Record<string, unknown> & Record<symbol, unknown>;
}>): Schema.Top =>
  ({
    ast: { propertySignatures: signatures },
  }) as unknown as Schema.Top;

describe("getKeyFromSchema", () => {
  test("returns row => row.id for an 'id' column", () => {
    const schema = makeSchema([{ name: "id", type: { _tag: "String" } }]);
    const getKey = getKeyFromSchema(schema);
    expect(getKey({ id: "abc" })).toBe("abc");
    expect(getKey({ id: "xyz" })).toBe("xyz");
  });

  test("returns the annotated primary-key column (isPrimaryKey)", () => {
    const schema = makeSchema([
      { name: "uuid", type: { _tag: "String" }, annotations: { isPrimaryKey: true } },
      { name: "email", type: { _tag: "String" }, annotations: {} },
    ]);
    const getKey = getKeyFromSchema(schema);
    expect(getKey({ uuid: "u-1", email: "a@b.c" })).toBe("u-1");
  });

  test("returns the annotated primary-key column (_id)", () => {
    const schema = makeSchema([
      { name: "slug", type: { _tag: "String" }, annotations: { _id: true } },
      { name: "id", type: { _tag: "String" } },
    ]);
    const getKey = getKeyFromSchema(schema);
    expect(getKey({ slug: "post-1", id: "ignored" })).toBe("post-1");
  });

  test("annotation wins over an 'id' column", () => {
    const schema = makeSchema([
      { name: "id", type: { _tag: "String" } },
      { name: "uuid", type: { _tag: "String" }, annotations: { isPrimaryKey: true } },
    ]);
    const getKey = getKeyFromSchema(schema);
    expect(getKey({ id: "ignored", uuid: "u-2" })).toBe("u-2");
  });

  test("throws when no usable column exists (empty struct)", () => {
    const schema = makeSchema([]);
    expect(() => getKeyFromSchema(schema)).toThrow(/no primary key found/);
  });

  test("throws when struct has fields but none are id or annotated", () => {
    const schema = makeSchema([
      { name: "title", type: { _tag: "String" } },
      { name: "body", type: { _tag: "String" } },
    ]);
    expect(() => getKeyFromSchema(schema)).toThrow(/no primary key found/);
  });
});
