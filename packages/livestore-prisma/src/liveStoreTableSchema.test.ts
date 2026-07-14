// @ts-nocheck

import { Schema } from "@livestore/livestore";
import { describe, expect, test } from "bun:test";

import { buildLiveStoreTableSchema } from "./liveStoreTableSchema.ts";
import type { TableDescriptor } from "./types.ts";

const makeColumn = (
  overrides: Partial<TableDescriptor["columns"][number]>,
): TableDescriptor["columns"][number] => ({
  name: "x",
  type: "string",
  required: true,
  list: false,
  unique: false,
  isEnum: false,
  ...overrides,
});

const makeTable = (columns: TableDescriptor["columns"]): TableDescriptor => ({
  name: "Test",
  primaryKey: "id",
  softDelete: null,
  columns,
  includedInSync: true,
});

describe("buildLiveStoreTableSchema", () => {
  test("builds a Schema.Struct with the correct field types", () => {
    const table = makeTable([
      makeColumn({ name: "id", type: "string" }),
      makeColumn({ name: "title", type: "string" }),
      makeColumn({ name: "count", type: "number" }),
      makeColumn({ name: "done", type: "boolean" }),
    ]);
    const schema = buildLiveStoreTableSchema("Test", table);
    expect(schema).toBeDefined();
    expect(typeof (schema as any).fields).toBe("object");
    const fields = (schema as any).fields;
    expect(fields.id).toBeDefined();
    expect(fields.title).toBeDefined();
    expect(fields.count).toBeDefined();
    expect(fields.done).toBeDefined();
  });

  test("maps 'date' columns to a string-backed date schema (DateFromString)", () => {
    const table = makeTable([
      makeColumn({ name: "id", type: "string" }),
      makeColumn({ name: "createdAt", type: "date", required: false }),
    ]);
    const schema = buildLiveStoreTableSchema("Test", table);
    const fields = (schema as any).fields;
    expect(fields.createdAt).toBeDefined();
    const decode = Schema.decodeUnknownSync(fields.createdAt);
    const decoded = decode("2026-01-02T03:04:05.000Z");
    expect(decoded).toBeInstanceOf(Date);
    expect((decoded as Date).toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  test("marks optional columns with Schema.NullOr", () => {
    const table = makeTable([
      makeColumn({ name: "id", type: "string" }),
      makeColumn({ name: "description", type: "string", required: false }),
    ]);
    const schema = buildLiveStoreTableSchema("Test", table);
    const field = (schema as any).fields.description;
    expect(field).toBeDefined();
    const decode = Schema.decodeUnknownSync(field);
    expect(() => decode(null)).not.toThrow();
    expect(decode(null)).toBe(null);
  });

  test("keeps required columns non-nullable", () => {
    const table = makeTable([makeColumn({ name: "id", type: "string", required: true })]);
    const schema = buildLiveStoreTableSchema("Test", table);
    const field = (schema as any).fields.id;
    const decode = Schema.decodeUnknownSync(field);
    expect(() => decode("abc")).not.toThrow();
    expect(() => decode(null)).toThrow();
  });

  test("throws on unknown column type", () => {
    expect(() =>
      buildLiveStoreTableSchema("Todo", {
        name: "todos",
        primaryKey: "id",
        softDelete: null,
        includedInSync: true,
        columns: [
          {
            name: "id",
            type: "string",
            required: true,
            list: false,
            unique: false,
            isEnum: false,
          },
          {
            name: "count",
            type: "bigint" as any,
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
