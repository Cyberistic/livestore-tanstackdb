import { Schema } from "@livestore/livestore";

export const Filter = Schema.Union(
  Schema.Literal("all"),
  Schema.Literal("active"),
  Schema.Literal("completed"),
);
export type Filter = typeof Filter.Type;
