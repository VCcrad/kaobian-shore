-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "updateFrequency" TEXT NOT NULL DEFAULT 'daily',
    "lastCrawled" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "parserConfig" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "job_postings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "publishDate" DATETIME,
    "deadline" DATETIME,
    "requirements" JSONB NOT NULL,
    "rawText" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "matchStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "job_postings_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
