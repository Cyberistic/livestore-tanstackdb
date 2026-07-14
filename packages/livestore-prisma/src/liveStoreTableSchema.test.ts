// @ts-nocheck

import { describe, expect, test } from "bun:test";

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
