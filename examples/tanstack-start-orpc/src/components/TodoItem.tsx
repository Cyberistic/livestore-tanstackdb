import type { TodoRow } from './types.ts'

/**
 * Single row in the todo list — checkbox toggle + label + destroy
 * button. Receives the row plus the parent's callbacks; lives inside
 * `<MainSection>` and doesn't touch the oRPC client itself (the parent
 * collection handles the commit handlers).
 */
export interface TodoItemProps {
  todo: TodoRow
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}

export const TodoItem = ({ todo, onToggle, onDelete }: TodoItemProps) => {
  return (
    <li className={todo.completed ? 'completed' : ''}>
      <div className="view">
        <input
          type="checkbox"
          className="toggle"
          checked={Boolean(todo.completed)}
          onChange={() => onToggle(todo.id)}
        />
        <label>{todo.text}</label>
        <button
          type="button"
          className="destroy"
          onClick={() => onDelete(todo.id)}
        />
      </div>
    </li>
  )
}