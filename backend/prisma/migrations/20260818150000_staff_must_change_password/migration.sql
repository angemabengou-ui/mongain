-- Force password change on first login for staff onboarded via the admin portal.
-- Defaults to false so existing/currently active staff are not suddenly interrupted;
-- POST /api/admin/staff explicitly sets it true for new accounts going forward.
ALTER TABLE "Staff" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
