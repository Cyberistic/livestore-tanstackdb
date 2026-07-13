#!/usr/bin/env bun
/**
 * Post-process the upstream prisma-effect-schema-generator output to
 * fix the bugs that the upstream maintainer is still merging:
 *
 *   1. `renderColumnDescriptor` (in the upstream src/render.ts) emits
 *      semicolon-separated object props (`{ name: "id"; type: 'string'; ... }`).
 *      JavaScript accepts them, TypeScript rejects them — so any consumer
 *      with strict TS settings gets 17 type errors on import.
 *
 * Tracking the upstream fix: https://github.com/Cyberistic/Prisma-Effect-Schema-Generator/pull/1
 * Once that's merged and a version ships, this script can be deleted.
 *
 * Idempotent — safe to run multiple times. The whole column-descriptor
 * block pattern is matched and rewritten to use commas between every
 * property.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = join(process.cwd(), "prisma/generated/client-schemas/index.ts");

const content = readFileSync(TARGET, "utf8");

// Match the column-descriptor object literal: `{ name: "..."; type: ...; ... }`
// Convert all `;<space>` between property values to `, ` within that block.
// Property values include: 'string', 'string', 'true', 'false', a JSON array
// literal `["ADMIN","USER"] as const`, etc. — but commas don't appear inside
// the property values (no nested objects). So the only `;` in the file are
// the property separators inside renderColumnDescriptor's output.
const fixed = content.replace(
  /\{\s*name:\s*"[^"]+";\s*type:\s*[^,]+(?:\s*;\s*[a-zA-Z]+:\s*[^,}]+)*\s*,?\s*\}/g,
  (match) => match.replace(/;\s+/g, ", "),
);

if (fixed === content) {
  console.log(
    "[fix-generator-output] no semicolon separators to fix — already patched or upstream fixed.",
  );
} else {
  writeFileSync(TARGET, fixed, "utf8");
  console.log("[fix-generator-output] fixed semicolon-separated object props in", TARGET);
}
