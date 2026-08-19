-- AuditLog.adminId can reference either a User (legacy ADMIN role) or a Staff (corp portal
-- account). It was enforced as a FK to User only, so every write from a Staff-authenticated
-- request (now the vast majority of admin actions) violated the constraint and crashed.
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_adminId_fkey";
CREATE INDEX IF NOT EXISTS "AuditLog_adminId_idx" ON "AuditLog"("adminId");
