CREATE TYPE "SiteCheckBrowser" AS ENUM ('CHROME', 'PHONE', 'MIXED');

CREATE TYPE "SiteCheckStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED');

CREATE TABLE "SiteCheckRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "browser" "SiteCheckBrowser" NOT NULL,
    "status" "SiteCheckStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SiteCheckRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteCheck" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "proxyId" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "status" "SiteCheckStatus" NOT NULL DEFAULT 'QUEUED',
    "title" TEXT,
    "scrolled" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SiteCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteCheckRun_organizationId_createdAt_idx" ON "SiteCheckRun"("organizationId", "createdAt");

CREATE INDEX "SiteCheckRun_userId_idx" ON "SiteCheckRun"("userId");

CREATE INDEX "SiteCheck_runId_idx" ON "SiteCheck"("runId");

CREATE INDEX "SiteCheck_proxyId_idx" ON "SiteCheck"("proxyId");

ALTER TABLE "SiteCheckRun" ADD CONSTRAINT "SiteCheckRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteCheckRun" ADD CONSTRAINT "SiteCheckRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteCheck" ADD CONSTRAINT "SiteCheck_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SiteCheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteCheck" ADD CONSTRAINT "SiteCheck_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
