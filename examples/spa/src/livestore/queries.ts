import { queryDb, type LiveQueryDef } from "@livestore/livestore";

import { tables } from "./schema.ts";

/**
 * Active UI session state (one row per session, stored in OPFS only).
 *
 * `LiveQueryDef<UiStateRow, 'def'>` is annotated explicitly because
 * TypeScript's inference for `queryDb(...)` doesn't survive an `export`
 * across module boundaries — the result type widens to
 * `LiveQueryDef<unknown, 'def'>` without the hint.
 */
type UiStateRow = typeof tables.uiState.Type;

export const uiState$: LiveQueryDef<UiStateRow, "def"> = queryDb(tables.uiState.get(), {
  label: "uiState",
}) as never;
