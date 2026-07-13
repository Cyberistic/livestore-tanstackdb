import type { Store } from '@livestore/livestore'

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/**
 * The shape of an oRPC (or any RPC) client. Intentionally loose: every
 * procedure is `(input?) => unknown | Promise<unknown>`. Real apps
 * (alkitab-alhakeem) plug their `orpc` client in via
 * `LiveStoreProvider`'s `oRPC` prop; this repo doesn't ship one.
 */
export type RpcProcedure = (input?: any) => unknown | Promise<unknown>

export type RpcClient = Record<string, Record<string, RpcProcedure | undefined>>

/**
 * Per-procedure wiring config supplied to `useTable(name, { rpc: {...} })`.
 *
 *   - `event?` — short camelCase key into the factory's `events` map
 *     (e.g. `"todoUpserted"` overrides the default `"todoCompleted"`).
 *   - `map?` — translate the (merged) row into the rpc input shape;
 *     default is passthrough. Receives `(row, original?)` so the same
 *     function can run on insert and update without re-declaring.
 */
export interface RpcProcedureSpec {
  event?: string
  map?: (row: any, original?: any) => any
}

/** `true` is shorthand for "use defaults, no overrides". */
export type RpcProcedureConfig = RpcProcedureSpec | true

/**
 * Procedure spec keyed by RPC namespace → procedure name. Drives which
 * LiveStore event to commit + which RPC to fire on insert/update/delete.
 *
 * @example
 * ```ts
 * useTable("MemorizationPath", {
 *   rpc: {
 *     teacher: {
 *       createPath: { map: row => ({ id: row.id, title: row.title }) },
 *       updatePath: { event: 'memorizationPathUpserted' },
 *       deletePath: {},
 *     },
 *   },
 *   rpcClient: orpc,
 * })
 * ```
 */
export type RpcConfig = Record<string, Record<string, RpcProcedureConfig>>

/** LiveStore `events` map value — a callable event factory. */
type EventFactory = ((...args: any[]) => unknown) & { name?: string }
type EventMap = Record<string, EventFactory>

export interface CreateMutationsConfig {
  /** LiveStore `Store` instance the collection is bridging to. */
  store: Store<any>
  /** PascalCase model name (e.g. `"Todo"`). Used to derive default event keys. */
  modelName: string
  /** Events map from `createLiveStoreDb` (short camelCase keys → event factories). */
  events: EventMap
  /** Optional RPC client. Procedures missing on the client become no-ops. */
  rpcClient?: RpcClient
  /** Per-procedure config. */
  rpcConfig?: RpcConfig
}

export interface MutationCallbacks {
  commitInsert: (row: any) => void
  /**
   * Tier 1.7 — bulk insert. Called once per transaction when the
   * schema declares a `v1.<Model>BulkUpserted` event. Receives every
   * row in the transaction; the handler should commit a single event
   * with `{ rows }` so the entire batch becomes one round-trip.
   *
   * Optional — when absent, `commitInsert` is called per row (legacy
   * N-event behaviour).
   */
  commitBulkInsert?: (rows: any[]) => void
  commitUpdate: (original: any, changes: any) => void
  commitDelete: (row: any) => void
}

/**
 * Which `commitInsert/Update/Delete` slot a procedure should be wired
 * into.
 */
export type MutationKind = 'insert' | 'update' | 'delete'

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

const lcFirst = (s: string): string =>
  s.charAt(0).toLowerCase() + s.slice(1)
const ucFirst = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1)

const findEvent = (
  events: EventMap,
  key: string,
): EventFactory | undefined => events[key]

const tryCommit = (
  store: Store<any>,
  evt: EventFactory | undefined,
  payload: unknown,
): void => {
  if (!evt) return
  store.commit(evt(payload as any) as never)
}

/**
 * Fire-and-forget rpc call. Always `void`s the promise so the caller
 * never awaits; never throws. RPC errors shouldn't block the local
 * optimistic LiveStore commit.
 */
const fireRpc = (
  proc: RpcProcedure | undefined,
  input: unknown,
): void => {
  if (!proc) return
  try {
    const result = proc(input)
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(() => {})
    }
  } catch {
    /* swallow sync RPC errors too */
  }
}

// ─────────────────────────────────────────────────────────────────────
// Procedure classification
// ─────────────────────────────────────────────────────────────────────

const DELETE_NAME_RE = /(?:Delete|Remove|Destroy)$/i
const INSERT_NAME_RE = /^(?:create|add|insert|new|upsert|save)/i
const UPDATE_NAME_RE = /^(?:update|set|mark|patch|put|toggle)/i

/**
 * Classify a procedure by name (+ optional `event` override) into the
 * `commitInsert/Update/Delete` slot(s) it should be wired into.
 *
 * Rules, applied in order:
 *
 *   1. **Explicit `event` override:** the factory already pinned a
 *      LiveStore event for this procedure, so the operation kind is
 *      unambiguous from the event name (`fooCreated` → insert,
 *      `fooDeleted` → delete, anything else → update).
 *   2. **Procedure-name heuristics:** `xxxDelete`-style names are
 *      delete; `createXxx`/`addXxx`-style are insert;
 *      `updateXxx`/`setXxx`-style are update.
 *   3. **Fallback:** neither heuristic matched (e.g. alkitab's
 *      `rpc.teacher.updateOwnProfile` — a single procedure that
 *      handles both insert *and* update as an upsert). In that case
 *      return `['insert', 'update']` so the same proc is called from
 *      both `commitInsert` and `commitUpdate`.
 *
 * Exported (pure) so unit tests can lock the behaviour in.
 */
export const classifyProcedure = (
  procName: string,
  eventOverride?: string,
): MutationKind[] => {
  if (eventOverride) {
    if (/Deleted$/i.test(eventOverride)) return ['delete']
    if (/Created$/i.test(eventOverride)) return ['insert']
    return ['update']
  }
  if (DELETE_NAME_RE.test(procName)) return ['delete']
  if (INSERT_NAME_RE.test(procName)) return ['insert']
  if (UPDATE_NAME_RE.test(procName)) return ['update']
  return ['insert', 'update']
}

// ─────────────────────────────────────────────────────────────────────
// createMutations
// ─────────────────────────────────────────────────────────────────────

interface ProcEntry {
  ns: string
  proc: string
  procFn: RpcProcedure | undefined
  spec: RpcProcedureSpec
}

const normalizeSpec = (raw: RpcProcedureConfig): RpcProcedureSpec =>
  raw === true ? {} : raw

const specEvent = (entry: ProcEntry): string | undefined =>
  entry.spec.event

const specMap = (entry: ProcEntry) => entry.spec.map

export function createMutations(
  config: CreateMutationsConfig,
): MutationCallbacks {
  const { store, modelName, events, rpcClient, rpcConfig } = config
  const modelPrefix = lcFirst(modelName)
  const createdKey = `${modelPrefix}Created`
  const deletedKey = `${modelPrefix}Deleted`
  const bulkUpsertedKey = `${modelPrefix}BulkUpserted`

  // ── Partition the rpcConfig into insert/update/delete buckets ──
  // One procedure may land in multiple buckets (the "upsert by
  // procedure name only" fallback in `classifyProcedure`).
  const partitioned: Record<MutationKind, ProcEntry[]> = {
    insert: [],
    update: [],
    delete: [],
  }

  if (rpcConfig) {
    const clientNs =
      (rpcClient as Record<string, Record<string, RpcProcedure | undefined>> | undefined) ?? {}

    for (const [ns, procs] of Object.entries(rpcConfig)) {
      if (!procs) continue
      const nsClient = clientNs[ns]
      for (const [proc, rawSpec] of Object.entries(procs)) {
        const spec = normalizeSpec(rawSpec)
        const procFn = nsClient?.[proc]
        const kinds = classifyProcedure(proc, spec.event)
        const entry: ProcEntry = { ns, proc, procFn, spec }
        for (const kind of kinds) partitioned[kind].push(entry)
      }
    }
  }

  // Cache the per-kind event override (the FIRST procedure with an
  // explicit override wins). Insert + delete are static; update is
  // recomputed per-call below because of auto-detection.
  const firstEventOverride = (
    entries: ProcEntry[],
  ): string | undefined => {
    for (const e of entries) {
      const ev = specEvent(e)
      if (ev) return ev
    }
    return undefined
  }

  const insertEventKey = firstEventOverride(partitioned.insert) ?? createdKey
  const deleteEventKey = firstEventOverride(partitioned.delete) ?? deletedKey
  const updateEventOverride = firstEventOverride(partitioned.update)
  const updateEntries = partitioned.update

  const runProc = (
    entry: ProcEntry,
    row: any,
    original?: any,
  ): void => {
    const map = specMap(entry)
    const payload = map ? map(row, original) : row
    fireRpc(entry.procFn, payload)
  }

  // ── Tier 1.7 — auto-detect the BulkUpserted event ──
  // When the schema declares `v1.<Model>BulkUpserted`, emit one event
  // per transaction instead of N per-row `*Created` events. Falls back
  // to undefined when the event is absent; `useTable`'s onInsert handler
  // then loops `commitInsert` per row.
  const bulkUpsertedEvent = findEvent(events, bulkUpsertedKey)
  const commitBulkInsert: MutationCallbacks['commitBulkInsert'] = bulkUpsertedEvent
    ? (rows) => {
        tryCommit(store, bulkUpsertedEvent, { rows })
        for (const e of partitioned.insert) runProc(e, rows as never)
      }
    : undefined

  return {
    commitInsert: (row) => {
      tryCommit(store, findEvent(events, insertEventKey), row)
      for (const e of partitioned.insert) runProc(e, row)
    },
    ...(commitBulkInsert
      ? { commitBulkInsert }
      : {}),

    commitUpdate: (original, changes) => {
      const id = ((changes as { id?: unknown }).id ??
        (original as { id: unknown }).id) as string
      const merged = { ...original, ...changes }

      if (updateEventOverride) {
        // Explicit override wins — caller pinned a specific event
        // (e.g. `${modelPrefix}Upserted`) in the rpc spec.
        tryCommit(store, findEvent(events, updateEventOverride), merged)
      } else {
        const changeEntries = Object.entries(changes as Record<string, unknown>)
        const onlyBooleans =
          changeEntries.length > 0 &&
          changeEntries.every(([, v]) => typeof v === 'boolean')

        if (onlyBooleans) {
          for (const [field, value] of changeEntries) {
            if (typeof value !== 'boolean') continue
            // Match `createLiveStoreDb`'s `eventSuffixesFor`: a field
            // whose PascalCase form already ends in "Completed" emits
            // just "Completed" (no doubling), e.g. `completed` →
            // `todoCompleted` not `todoCompletedCompleted`.
            const cap = ucFirst(field)
            const onKey =
              cap.endsWith('Completed')
                ? `${modelPrefix}Completed`
                : `${modelPrefix}${cap}Completed`
            const key = value ? onKey : `${modelPrefix}${cap}Uncompleted`
            tryCommit(store, findEvent(events, key), { id })
          }
        } else {
          const upsertKey = `${modelPrefix}Upserted`
          const upsertEvent = findEvent(events, upsertKey)
          if (upsertEvent) tryCommit(store, upsertEvent, { row: merged })
        }
      }

      for (const e of updateEntries) runProc(e, merged, original)
    },

    commitDelete: (row) => {
      const id = (row as { id: string }).id
      tryCommit(store, findEvent(events, deleteEventKey), {
        id,
        deletedAt: new Date(),
      })
      for (const e of partitioned.delete) {
        const map = specMap(e)
        fireRpc(e.procFn, map ? map(row) : { id })
      }
    },
  }
}
