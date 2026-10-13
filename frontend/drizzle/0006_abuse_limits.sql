CREATE TABLE "api_rate_limit" (
  "key" text PRIMARY KEY NOT NULL,
  "hits" bigint[] NOT NULL,
  "expires_at" bigint NOT NULL,
  "allowed" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_rate_limit_expiry_idx" ON "api_rate_limit" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE "auth_rate_limit" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "count" integer NOT NULL,
  "last_request" bigint NOT NULL,
  CONSTRAINT "auth_rate_limit_key_unique" UNIQUE("key")
);
