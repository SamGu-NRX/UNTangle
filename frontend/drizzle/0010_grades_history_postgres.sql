CREATE TABLE "grades_history_budget" (
	"source" text PRIMARY KEY NOT NULL,
	"next_permit_at" timestamp with time zone NOT NULL,
	"cooldown_until" timestamp with time zone NOT NULL,
	"sent_at" bigint[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades_history_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"record" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
