#!/usr/bin/env bun
/**
 * Compatibility patches for the LiveStore snapshot against Effect 4.0.0-beta.98.
 *
 * The installed LiveStore snapshot is built against Effect 4.0.0-beta.83. Between
 * beta.83 and beta.98 there are two breaking changes that affect runtime behavior:
 *
 * 1. `Schedule.bothLeft` was removed (replaced by `Schedule.max([...])`). The
 *    LiveStore snapshot imports it at module load, which crashes immediately
 *    on beta.98 with `Schedule.bothLeft is not a function`.
 *
 * 2. `RpcMessage.RequestEncoded.id` changed from `string` to `string | number`.
 *    The LiveStore sync-cf Durable Object stores active pull request IDs in the
 *    WebSocket attachment, but its schema declares `pullRequestIds: Array(String)`.
 *    When the client sends a Pull request with a numeric ID (commonly `0`), the
 *    attachment later fails decode on DO wake-up with:
 *
 *      SchemaError: Expected string, got 0
 *        at ["pullRequestIds"][0]
 *
 *    This is harmless but spams the console on every app launch.
 *
 * These patches are workarounds until the upstream LiveStore snapshot is rebuilt
 * against Effect 4.0.0-beta.98 or later.
 *
 * Idempotent: skips files that already contain the patch markers.
 * Safe to run after every `bun install`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEDULE_TARGET = `
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

const walkUp = (filePath) => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, "..", ...filePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};

const patchSchedule = () => {
  const target = walkUp(["node_modules", "@livestore", "utils", "dist", "effect", "Schedule.js"]);
  if (!target) {
    console.log("[patch-livestore] @livestore/utils not installed; skipping Schedule patch");
    return;
  }

  const current = readFileSync(target, "utf8");
  if (current.includes("PATCHED by livestore-tanstack-db/v4ScheduleShim")) {
    console.log(`[patch-livestore] Schedule already patched: ${target}`);
    return;
  }

  writeFileSync(target, SCHEDULE_TARGET.trim() + "\n", "utf8");
  console.log(`[patch-livestore] patched Schedule.js: ${target}`);
};

const patchSyncCf = () => {
  const target = walkUp(["node_modules", "@livestore", "sync-cf", "dist", "cf-worker", "shared.js"]);
  if (!target) {
    console.log("[patch-livestore] @livestore/sync-cf not installed; skipping sync-cf patch");
    return;
  }

  const current = readFileSync(target, "utf8");
  const marker = "PATCHED by livestore-tanstack-db/syncCfPullRequestIds";
  if (current.includes(marker)) {
    console.log(`[patch-livestore] sync-cf already patched: ${target}`);
    return;
  }

  const patched = current.replace(
    "pullRequestIds: Schema.Array(Schema.String),",
    "pullRequestIds: Schema.Array(Schema.Union(Schema.String, Schema.Number)), // " + marker,
  );

  if (patched === current) {
    console.log(`[patch-livestore] could not find pullRequestIds schema in ${target}`);
    return;
  }

  writeFileSync(target, patched, "utf8");
  console.log(`[patch-livestore] patched sync-cf shared.js: ${target}`);
};

patchSchedule();
patchSyncCf();
