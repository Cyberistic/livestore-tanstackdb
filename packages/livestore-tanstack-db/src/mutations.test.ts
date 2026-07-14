// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { classifyProcedure } from "./mutations.ts";

describe("classifyProcedure", () => {
  test("classifies createXxx as insert", () => {
    expect(classifyProcedure("createPost")).toEqual(["insert"]);
  });

  test("classifies xxxDelete as delete", () => {
    expect(classifyProcedure("postDelete")).toEqual(["delete"]);
  });

  test("classifies updateXxx as update", () => {
    expect(classifyProcedure("updatePost")).toEqual(["update"]);
  });

  test("event override 'XxxUpserted' wins and maps to insert", () => {
    expect(classifyProcedure("ownProfile", "profileUpserted")).toEqual(["insert"]);
  });

  test("event override 'XxxDeleted' wins and maps to delete", () => {
    expect(classifyProcedure("ownProfile", "profileDeleted")).toEqual(["delete"]);
  });

  test("falls back to ['insert', 'update'] when no rule matches", () => {
    expect(classifyProcedure("weirdName")).toEqual(["insert", "update"]);
  });

  test("event override 'XxxCreated' maps to insert", () => {
    expect(classifyProcedure("anything", "profileCreated")).toEqual(["insert"]);
  });

  test("event override without a known suffix defaults to update", () => {
    expect(classifyProcedure("anything", "profileTouched")).toEqual(["update"]);
  });
});
