// @ts-nocheck
import { describe, expect, jest, test } from "bun:test";

import { buildCommitCallbacks } from "./useTable.ts";

describe("buildCommitCallbacks — client document insert", () => {
  test("uses the `${name}Set` event when inserting into a client document", () => {
    // The SPA's `uiState` is the canonical client document: the runtime
    // signature of its set event is `setEvent(value, id?)` (the value is
    // the document payload, e.g. `{ filter }`), NOT a `{ id, value }`
    // wrapper. See examples/spa/src/components/Footer.tsx for the
    // matching real-world call: `events.uiStateSet({ filter })`.
    const setEvent = jest.fn((value: unknown) => ({ name: "uiStateSet", args: { value } }));
    const store = { commit: jest.fn() } as any;
    const events = { uiStateSet: setEvent };

    const callbacks = buildCommitCallbacks(store, "uiState", events);

    expect(typeof callbacks.commitInsert).toBe("function");

    // TanStack DB's `mutation.modified` is the document value. It must be
    // forwarded to the `set` event unchanged — no `{ id, value }` wrap.
    const row = { filter: "all" } as unknown as Parameters<NonNullable<typeof callbacks.commitInsert>>[0];
    callbacks.commitInsert!(row);

    expect(setEvent).toHaveBeenCalledTimes(1);
    expect(setEvent).toHaveBeenCalledWith({ filter: "all" });
    expect(store.commit).toHaveBeenCalledTimes(1);
  });

  test("does not look up the `${name}Created` event for a client document", () => {
    // Regression: pre-fix, the client-document branch routed through
    // `makeCommitInsert` → `syncedEventFor(name, events, "Created")`,
    // which threw "no `uiStateCreated` event found in schema".
    // Asserting that the insert path completes without throwing is
    // sufficient — if the helper regresses to `Created`, the
    // `setEvent` mock below will not be called.
    const setEvent = jest.fn((value: unknown) => ({ name: "uiStateSet", args: { value } }));
    const store = { commit: jest.fn() } as any;
    const events = { uiStateSet: setEvent };

    const callbacks = buildCommitCallbacks(store, "uiState", events);

    expect(() => callbacks.commitInsert!({ newTodoText: "hi" } as never)).not.toThrow();
    expect(setEvent).toHaveBeenCalledWith({ newTodoText: "hi" });
  });
});

describe("buildCommitCallbacks — synced table insert (regression guard)", () => {
  test("uses `${lcFirst(name)}Created` for a synced table", () => {
    // Plan-002 reviewers should confirm the existing synced-table path
    // is unchanged. A `Created` event + missing `Set` event steers
    // `buildCommitCallbacks` into the synced branch.
    const createdEvent = jest.fn((row: unknown) => ({ name: "todoCreated", args: { row } }));
    const deletedEvent = jest.fn();
    const store = { commit: jest.fn() } as any;
    const events = { todoCreated: createdEvent, todoDeleted: deletedEvent };

    const callbacks = buildCommitCallbacks(store, "Todo", events);

    callbacks.commitInsert!({ id: "1", title: "buy milk" } as never);

    expect(createdEvent).toHaveBeenCalledTimes(1);
    expect(createdEvent).toHaveBeenCalledWith({ id: "1", title: "buy milk" });
    expect(store.commit).toHaveBeenCalledTimes(1);
  });
});
