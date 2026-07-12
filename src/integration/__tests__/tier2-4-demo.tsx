import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useTable } from '../useTable.ts'

// Tier 2.4 verification — does the row type flow through?
export const Tier24Demo = () => {
  const todos = useTable('Todo')
  const { data } = useLiveQuery((q) =>
    q.from({ todo: todos.collection })
     .select(({ todo }) => ({ id: todo.id, title: todo.text }))
  )
  // The select projection should preserve id (string) and title (string)
  return <div>{data?.map(d => <span>{d.title}</span>)}</div>
}
