// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { softDeleteLivePredicate } from "./softDeleteLivePredicate.ts";

describe("softDeleteLivePredicate", () => {
  test("returns true for non-object inputs", () => {
    expect(softDeleteLivePredicate(null)).toBe(true);
    expect(softDeleteLivePredicate(undefined)).toBe(true);
    expect(softDeleteLivePredicate("not-a-row")).toBe(true);
    expect(softDeleteLivePredicate(42)).toBe(true);
    expect(softDeleteLivePredicate(true)).toBe(true);
  });

  test("returns true when deletedAt and archivedAt are null/undefined", () => {
    expect(softDeleteLivePredicate({})).toBe(true);
    expect(softDeleteLivePredicate({ deletedAt: null })).toBe(true);
    expect(softDeleteLivePredicate({ archivedAt: undefined })).toBe(true);
    expect(softDeleteLivePredicate({ deletedAt: null, archivedAt: null })).toBe(true);
  });

  test("returns false when deletedAt is set", () => {
    expect(softDeleteLivePredicate({ deletedAt: new Date() })).toBe(false);
    expect(softDeleteLivePredicate({ deletedAt: "2026-01-01" })).toBe(false);
  });

  test("returns false when archivedAt is set", () => {
    expect(softDeleteLivePredicate({ archivedAt: new Date() })).toBe(false);
    expect(softDeleteLivePredicate({ archivedAt: "2026-01-01" })).toBe(false);
  });

  test("returns false when isDeleted is true", () => {
    expect(softDeleteLivePredicate({ isDeleted: true })).toBe(false);
  });

  test("returns true when isDeleted is false or undefined", () => {
    expect(softDeleteLivePredicate({ isDeleted: false })).toBe(true);
    expect(softDeleteLivePredicate({ isDeleted: undefined })).toBe(true);
  });
});
