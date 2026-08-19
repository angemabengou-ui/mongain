-- Journal technique des erreurs backend, visible depuis l'admin-web (Erreurs Système).
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT,
    "path" TEXT,
    "userId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ErrorLog_source_idx" ON "ErrorLog"("source");
CREATE INDEX "ErrorLog_resolved_idx" ON "ErrorLog"("resolved");
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");
