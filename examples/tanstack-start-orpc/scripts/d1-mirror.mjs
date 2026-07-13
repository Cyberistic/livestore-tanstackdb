import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const source = resolve(process.argv[2] ?? "eventlog.db");
const storeId = process.argv[3];
const local = process.argv.includes("--local");
const databaseName = process.env.D1_DATABASE_NAME ?? "todos-db";
const database = new DatabaseSync(source, { readOnly: true });

const rows = database
  .prepare(
    `SELECT name, argsJson
     FROM eventlog
     ORDER BY seqNumGlobal, seqNumClient, seqNumRebaseGeneration`,
  )
  .all();

database.close();

const inferredStoreId = storeId ?? source.split("/").at(-2);
if (inferredStoreId === undefined) {
  throw new Error("Pass a store ID as the second argument");
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const statements = [
  `DELETE FROM events WHERE store_id = ${quote(inferredStoreId)};`,
  ...rows.map(
    (row) =>
      `INSERT INTO events (store_id, name, args) VALUES (${quote(inferredStoreId)}, ${quote(row.name)}, ${quote(row.argsJson)});`,
  ),
];
const directory = mkdtempSync(join(tmpdir(), "livestore-d1-mirror-"));
const sqlPath = join(directory, "mirror.sql");

try {
  writeFileSync(sqlPath, `${statements.join("\n")}\n`);
  execFileSync(
    "bun",
    [
      "x",
      "wrangler",
      "d1",
      "execute",
      databaseName,
      local ? "--local" : "--remote",
      "--file",
      sqlPath,
    ],
    { stdio: "inherit" },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log(`Mirrored ${rows.length} events for ${inferredStoreId}`);
