#!/usr/bin/env bun
/**
 * Patch the LiveStore snapshot's Schedule.js to work with Effect v4.
 *
 * Effect v4 removes `Schedule.both*` (replaced by `Schedule.max([...])`).
 * The LiveStore snapshot calls `Schedule.bothLeft(...)` at module load,
 * which crashes with `Schedule.bothLeft is not a function` on Effect v4
 * betas. We rewrite the file in node_modules to use `Schedule.max`.
 *
 * Idempotent: skips if the file already contains the patched content.
 * Safe to run after every `bun install` — re-applies the patch if the
 * snapshot reinstalled the unpatched file.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = `
import { Duration, Effect, pipe, Schedule } from 'effect';
export * from 'effect/Schedule';
// PATCHED by livestore-tanstack-db/v4ScheduleShim:
// \`Schedule.bothLeft\` was removed in the upcoming Effect v4 release
// in favour of \`Schedule.max([...])\` — see
// https://github.com/Effect-TS/effect-smol/pull/2551.
export const exponentialBackoff10Sec = Schedule.max([
  pipe(
    Schedule.exponential(Duration.millis(10), 4),
    Schedule.modifyDelay((_, delay) => Effect.succeed(Duration.min(delay, Duration.seconds(1)))),
  ),
  Schedule.during(Duration.seconds(10)),
]);
//# sourceMappingURL=Schedule.js.map
`;

// Walk up from this script's directory until we find the workspace
// root (where `node_modules/@livestore/utils/...` lives, hoisted by
// bun's workspace manager). Both examples share the same workspace
// root so a single walk-up works for either.
let dir = dirname(fileURLToPath(import.meta.url));
let target = null;
for (let i = 0; i < 6; i++) {
  const candidate = resolve(
    dir,
    "..",
    "node_modules",
    "@livestore",
    "utils",
    "dist",
    "effect",
    "Schedule.js",
  );
  if (existsSync(candidate)) {
    target = candidate;
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

if (!target) {
  console.log("[patch-schedule] @livestore/utils not installed; skipping");
  process.exit(0);
}

const current = readFileSync(target, "utf8");

if (current.includes("PATCHED by livestore-tanstack-db/v4ScheduleShim")) {
  console.log(`[patch-schedule] already patched: ${target}`);
  process.exit(0);
}

writeFileSync(target, TARGET.trim() + "\n", "utf8");
console.log(`[patch-schedule] patched ${target}`);
