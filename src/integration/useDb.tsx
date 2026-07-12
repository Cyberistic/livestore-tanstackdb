/**
 * Tier 2.1 — the `useDb` hook, an ergonomic alternative to the lazy
 * proxy for components that want to spell out the model name
 * explicitly (e.g. dynamic `[name]` renderers, tables keyed by a URL
 * parameter, etc.).
 *
 * Internally it's just a typed re-export of `useTable(...)`. The lazy
 * proxy (`createLazyDb(...)`) does exactly the same call under the
 * hood when it detects a render context — this hook just lets callers
 * skip the proxy for cases where they already know the model name.
 *
 * @example
 * ```ts
 * function DynamicTable({ name }: { name: TableName }) {
 *   const { collection } = useDb(name)
 *   const { data } = useLiveQuery(q => q.from({ t: collection }))
 *   return <List items={data} />
 * }
 * ```
 */
import { useTable } from './useTable.ts'
import type {
  RowOf,
  TableName,
  UseTableOptions,
  UseTableResult,
} from './useTable.ts'

export function useDb<TName extends TableName>(
  name: TName,
  options?: UseTableOptions,
): UseTableResult<TName> {
  return useTable(name, options)
}

export type { RowOf, TableName, UseTableOptions, UseTableResult }