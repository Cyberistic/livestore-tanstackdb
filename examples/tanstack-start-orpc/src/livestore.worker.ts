// The Effect v4 snapshot is patched in-place at install time by
// `scripts/patch-schedule.mjs` (see `postinstall` in package.json).
// No runtime shim needed here.

import { makeWorker } from "@livestore/adapter-web/worker";
import { makeWsSync } from "@livestore/sync-cf/client";

import { schema } from "./livestore/schema.ts";

makeWorker({
  schema,
  sync: {
    backend: makeWsSync({ url: `${globalThis.location.origin}/sync` }),
    initialSyncOptions: { _tag: "Blocking", timeout: 5000 },
  },
});
