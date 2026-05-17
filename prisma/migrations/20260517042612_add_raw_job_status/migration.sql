-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RawJob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "publishedAt" TEXT NOT NULL DEFAULT '',
    "content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_RawJob" ("content", "createdAt", "id", "link", "publishedAt", "title", "updatedAt") SELECT "content", "createdAt", "id", "link", "publishedAt", "title", "updatedAt" FROM "RawJob";
DROP TABLE "RawJob";
ALTER TABLE "new_RawJob" RENAME TO "RawJob";
CREATE UNIQUE INDEX "RawJob_link_key" ON "RawJob"("link");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
