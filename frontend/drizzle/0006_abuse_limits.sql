CREATE TABLE "api_rate_limit" (
	"window_index" integer NOT NULL,
	"route" text NOT NULL,
	"caller" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "api_rate_limit_window_index_route_caller_pk" PRIMARY KEY("window_index","route","caller")
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limit_key_unique" UNIQUE("key")
);
