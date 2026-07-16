// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { getKeyFromSchema } from "./getKeyFromSchema.ts";

describe("getKeyFromSchema", () => {
  test("returns 'id' when schema has no fields", () => {
    expect(getKeyFromSchema({})).toBe("id");
    expect(getKeyFromSchema({ fields: {} })).toBe("id");
  });

  test("returns 'id' when schema is null/undefined or not an object", () => {
    expect(getKeyFromSchema(null)).toBe("id");
    expect(getKeyFromSchema(undefined)).toBe("id");
    expect(getKeyFromSchema("not-a-schema")).toBe("id");
  });

  test("returns the annotated primary-key field when ast.isPrimaryKey is set", () => {
    const schema = {
      fields: {
        id: { ast: { isPrimaryKey: true } },
        email: { ast: { isPrimaryKey: false } },
      },
    };
    expect(getKeyFromSchema(schema)).toBe("id");
  });

  test("returns the annotated primary-key field even when its name is not 'id'", () => {
    const schema = {
      fields: {
        uuid: { ast: { isPrimaryKey: true } },
        email: { ast: {} },
      },
    };
    expect(getKeyFromSchema(schema)).toBe("uuid");
  });

  test("returns a field ending in 'Id' when no annotation is present", () => {
    const schema = {
      fields: {
        postId: { ast: {} },
        title: { ast: {} },
      },
    };
    expect(getKeyFromSchema(schema)).toBe("postId");
  });

  test("falls back to 'id' when no Id-like field exists", () => {
    const schema = {
      fields: {
        title: { ast: {} },
        body: { ast: {} },
      },
    };
    expect(getKeyFromSchema(schema)).toBe("id");
  });

  test("prefers the annotation over a name ending in 'Id'", () => {
    const schema = {
      fields: {
        postId: { ast: { isPrimaryKey: false } },
        uuid: { ast: { isPrimaryKey: true } },
      },
    };
    expect(getKeyFromSchema(schema)).toBe("uuid");
  });
});
