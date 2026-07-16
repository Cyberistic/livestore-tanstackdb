CREATE TABLE "todos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" DATETIME
);

CREATE TABLE "events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "store_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "events_store_id_id_idx" ON "events"("store_id", "id");
