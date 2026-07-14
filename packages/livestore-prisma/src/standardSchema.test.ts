// @ts-nocheck
import { Schema } from "@livestore/livestore";
import { describe, expect, test } from "bun:test";

import { toLiveStoreSchema, toStandardSchemaV1 } from "./standardSchema.ts";

describe("toStandardSchemaV1", () => {
  test("returns a schema wrapped with the Standard Schema V1 marker", () => {
    const inner = Schema.Struct({ id: Schema.String, age: Schema.Number });
    const wrapped = toStandardSchemaV1(inner);
    // The wrapped schema must expose `~standard` so it satisfies
    // the Standard Schema V1 contract — that's how LiveStore narrows
    // its `Context`/`EncodingServices` requirements to `never`.
    expect((wrapped as any)["~standard"]).toBeDefined();
    expect(typeof (wrapped as any)["~standard"].validate).toBe("function");
  });

  test("the underlying Standard Schema validator accepts valid input", () => {
    const inner = Schema.Struct({ id: Schema.String, age: Schema.Number });
    const wrapped = toStandardSchemaV1(inner);
    const result = (wrapped as any)["~standard"].validate({ id: "abc", age: 1 });
    expect(result.value).toEqual({ id: "abc", age: 1 });
  });

  test("the underlying Standard Schema validator surfaces issues for invalid input", () => {
    const inner = Schema.Struct({ id: Schema.String, age: Schema.Number });
    const wrapped = toStandardSchemaV1(inner);
    const result = (wrapped as any)["~standard"].validate({ id: 123, age: "not-a-number" });
    expect(result.issues).toBeDefined();
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("toLiveStoreSchema", () => {
  test("accepts the upstream schema without compile error", () => {
    const inner = Schema.Struct({ id: Schema.String });
    const bridged = toLiveStoreSchema(inner);
    expect(bridged).toBeDefined();
  });

  test("accepts an already-wrapped StandardSchemaV1 schema", () => {
    const inner = Schema.Struct({ id: Schema.String });
    const wrapped = toStandardSchemaV1(inner);
    // Re-bridging an already-StandardSchemaV1 schema must still pass
    // (this is the path `createLiveStoreDb` walks for the generated
    // `prisma-effect-schema-generator` output).
    const bridged = toLiveStoreSchema(wrapped);
    expect(bridged).toBeDefined();
  });
});
