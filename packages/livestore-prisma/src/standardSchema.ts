/**
 * Wrap an Effect Schema with `Schema.standardSchemaV1(...)` so it satisfies
 * the Standard Schema v1 shape AND narrows its `Context` to `never`.
 *
 * Required so the generated `State.SQLite.clientDocument({ schema })`
 * call's variance check passes (it expects `Schema<T, _, never>`).
 */
export const toStandardSchemaV1 = <S>(s: S): S => s