ALTER TABLE "session" ADD COLUMN "security_generation" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE "device_security" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "generation" integer NOT NULL DEFAULT 0,
  "active_transitions" integer NOT NULL DEFAULT 0 CHECK (active_transitions >= 0)
);
--> statement-breakpoint
CREATE TABLE "device_grant" (
  "id" text PRIMARY KEY,
  "device_code_hash" text NOT NULL UNIQUE,
  "user_code_hash" text NOT NULL UNIQUE,
  "code_challenge" text NOT NULL,
  "client_kind" text NOT NULL CHECK (client_kind IN ('mobile', 'extension')),
  "schedule_id" text,
  "status" text NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'active', 'revoked')),
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "generation" integer,
  "code_expires_at" bigint NOT NULL,
  "expires_at" bigint NOT NULL,
  "idle_expires_at" bigint NOT NULL,
  CHECK ((client_kind = 'extension' AND schedule_id IS NOT NULL) OR (client_kind = 'mobile' AND schedule_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX "device_grant_user_idx" ON "device_grant" ("user_id");
--> statement-breakpoint
CREATE TABLE "device_token" (
  "hash" text PRIMARY KEY,
  "grant_id" text NOT NULL REFERENCES "device_grant"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK (kind IN ('access', 'refresh')),
  "expires_at" bigint NOT NULL,
  "used_at" bigint
);
--> statement-breakpoint
CREATE INDEX "device_token_grant_idx" ON "device_token" ("grant_id");
