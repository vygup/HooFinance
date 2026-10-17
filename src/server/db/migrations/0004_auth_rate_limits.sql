CREATE TABLE "auth_rate_bucket" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempt_timestamps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_bucket_expiry" ON "auth_rate_bucket" USING btree ("expires_at");