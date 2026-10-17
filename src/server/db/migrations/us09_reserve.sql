CREATE TABLE "goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"currency" text NOT NULL,
	"account_id" uuid NOT NULL,
	"ordinary_target" numeric,
	"target_date" date,
	"archived_at" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "goal_scope_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "goal_type_target" CHECK (("goal"."type"='ordinary' AND "goal"."ordinary_target" IS NOT NULL AND "goal"."ordinary_target">0 AND "goal"."ordinary_target" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) OR ("goal"."type"='reserve' AND "goal"."ordinary_target" IS NULL)),
	CONSTRAINT "goal_version_positive" CHECK ("goal"."version">0)
);
--> statement-breakpoint
CREATE TABLE "reserve_settings" (
	"workspace_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"monthly_amount" numeric NOT NULL,
	"coverage_months" numeric NOT NULL,
	"linked_obligation_id" uuid,
	CONSTRAINT "reserve_one_goal" UNIQUE("workspace_id","goal_id"),
	CONSTRAINT "reserve_amount_valid" CHECK ("reserve_settings"."monthly_amount">=0 AND "reserve_settings"."monthly_amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
	CONSTRAINT "reserve_months_valid" CHECK ("reserve_settings"."coverage_months">0 AND "reserve_settings"."coverage_months"=trunc("reserve_settings"."coverage_months") AND "reserve_settings"."coverage_months" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
	CONSTRAINT "reserve_link_unavailable" CHECK ("reserve_settings"."linked_obligation_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_workspace_id_account_id_currency_financial_account_workspace_id_id_currency_fk" FOREIGN KEY ("workspace_id","account_id","currency") REFERENCES "public"."financial_account"("workspace_id","id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_settings" ADD CONSTRAINT "reserve_settings_workspace_id_goal_id_goal_workspace_id_id_fk" FOREIGN KEY ("workspace_id","goal_id") REFERENCES "public"."goal"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_one_active_account" ON "goal" USING btree ("workspace_id","account_id") WHERE "goal"."archived_at" IS NULL;
--> statement-breakpoint
ALTER TABLE goal ADD CONSTRAINT goal_currency_scale_valid CHECK (budget_currency_scale(currency) IS NOT NULL AND (ordinary_target IS NULL OR scale(ordinary_target)<=budget_currency_scale(currency)));
--> statement-breakpoint
CREATE FUNCTION validate_goal_reserve() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid uuid; wid uuid; g goal%ROWTYPE; r reserve_settings%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='goal' THEN gid=NEW.id; wid=NEW.workspace_id;
 ELSE gid=COALESCE(NEW.goal_id,OLD.goal_id); wid=COALESCE(NEW.workspace_id,OLD.workspace_id); END IF;
 SELECT * INTO g FROM goal WHERE workspace_id=wid AND id=gid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM reserve_settings WHERE workspace_id=wid AND goal_id=gid;
 IF g.type='reserve' THEN
   IF r.goal_id IS NULL OR scale(r.monthly_amount)>budget_currency_scale(g.currency) THEN RAISE EXCEPTION 'INVALID_RESERVE_SETTINGS'; END IF;
 ELSIF r.goal_id IS NOT NULL THEN RAISE EXCEPTION 'ORDINARY_GOAL_HAS_RESERVE_SETTINGS'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER goal_reserve_consistency AFTER INSERT OR UPDATE ON goal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_goal_reserve();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER reserve_goal_consistency AFTER INSERT OR UPDATE OR DELETE ON reserve_settings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_goal_reserve();
--> statement-breakpoint
CREATE FUNCTION protect_goal_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN RAISE EXCEPTION 'GOAL_SCOPE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER goal_scope_rules BEFORE UPDATE ON goal FOR EACH ROW EXECUTE FUNCTION protect_goal_scope();
--> statement-breakpoint
CREATE FUNCTION protect_reserve_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.workspace_id,NEW.goal_id) IS DISTINCT FROM (OLD.workspace_id,OLD.goal_id) THEN RAISE EXCEPTION 'RESERVE_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reserve_identity_rules BEFORE UPDATE ON reserve_settings FOR EACH ROW EXECUTE FUNCTION protect_reserve_identity();
