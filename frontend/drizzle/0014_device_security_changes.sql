-- One account security change at a time, with its start time, so a change
-- that never finishes stops blocking the account after securityChangeTimeout
-- (src/server/auth/device-grants.ts, DeviceStore). A change left open under
-- 0013's active_transitions counter is not carried over: its first bump has
-- already ended the account's earlier grants and sessions. active_transitions
-- stays so instances still running 0013 code keep working during a deploy.
ALTER TABLE "device_security" ADD COLUMN "change_id" text;
--> statement-breakpoint
ALTER TABLE "device_security" ADD COLUMN "change_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "device_security" ADD CONSTRAINT "device_security_change_check"
  CHECK (("change_id" IS NULL) = ("change_started_at" IS NULL));
