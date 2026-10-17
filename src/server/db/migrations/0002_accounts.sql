CREATE TABLE "financial_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" text NOT NULL,
	"opening_balance" numeric NOT NULL,
	"balance_projection" numeric NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "account_scope_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "account_scope_currency" UNIQUE("workspace_id","id","currency"),
	CONSTRAINT "account_currency_valid" CHECK ("financial_account"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "account_money_finite" CHECK ("financial_account"."opening_balance" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND "financial_account"."balance_projection" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
	CONSTRAINT "account_version_positive" CHECK ("financial_account"."version">0)
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"archived_at" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "category_scope_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "category_kind_valid" CHECK ("category"."kind" IN ('income','expense')),
	CONSTRAINT "category_version_positive" CHECK ("category"."version">0)
);
--> statement-breakpoint
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_scope_archive" ON "financial_account" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "category_scope_kind_archive" ON "category" USING btree ("workspace_id","kind","archived_at");