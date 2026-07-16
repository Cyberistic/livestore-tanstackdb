// @ts-nocheck
import { describe, expect, jest, test } from "bun:test";

import { classifyProcedure, createMutations } from "./mutations.ts";

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

// Regression: pre-fix, `commitDelete` always wrote `deletedAt: new Date()`
// even when `createLiveStoreDb` emitted the delete event with a different
// column name (e.g. `archivedAt`). The materialiser would then reject the
// event because `archivedAt` was undefined in the payload.
describe("createMutations — softDeleteColumn", () => {
  const buildFixture = (overrides: Record<string, unknown> = {}) => {
    const deletedEvent = jest.fn((payload: unknown) => ({
      name: "todoDeleted",
      args: payload,
    }));
    const events = { todoDeleted: deletedEvent };
    const store = { commit: jest.fn() } as any;
    const cb = createMutations({
      store,
      modelName: "Todo",
      events,
      ...overrides,
    });
    return { cb, deletedEvent, store };
  };

  test("emits `deletedAt: Date` by default", () => {
    const { cb, deletedEvent, store } = buildFixture();
    cb.commitDelete({ id: "t1" } as never);

    expect(deletedEvent).toHaveBeenCalledTimes(1);
    const payload = deletedEvent.mock.calls[0][0];
    expect(payload).toHaveProperty("id", "t1");
    expect(payload).toHaveProperty("deletedAt");
    expect(payload.deletedAt).toBeInstanceOf(Date);
    expect(store.commit).toHaveBeenCalledTimes(1);
  });

  test('emits `archivedAt: Date` when `softDeleteColumn: "archivedAt"`', () => {
    const { cb, deletedEvent, store } = buildFixture({
      softDeleteColumn: "archivedAt",
    });
    cb.commitDelete({ id: "t2" } as never);

    expect(deletedEvent).toHaveBeenCalledTimes(1);
    const payload = deletedEvent.mock.calls[0][0];
    expect(payload).toEqual({ id: "t2", archivedAt: expect.any(Date) });
    expect(payload).not.toHaveProperty("deletedAt");
    expect(payload.archivedAt).toBeInstanceOf(Date);
    expect(store.commit).toHaveBeenCalledTimes(1);
  });

  test("emits the configured column even when the default name is also present on the row", () => {
    const { cb, deletedEvent } = buildFixture({
      softDeleteColumn: "archivedAt",
    });
    cb.commitDelete({ id: "t3", deletedAt: new Date(0) } as never);

    const payload = deletedEvent.mock.calls[0][0];
    expect(payload.archivedAt).toBeInstanceOf(Date);
    expect(payload).not.toHaveProperty("deletedAt");
  });
});
