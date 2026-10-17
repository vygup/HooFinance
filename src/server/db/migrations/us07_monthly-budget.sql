CREATE TABLE "budget_limit" (
	"workspace_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	CONSTRAINT "budget_category_unique" UNIQUE("budget_id","category_id"),
	CONSTRAINT "budget_limit_valid" CHECK ("budget_limit"."amount">=0 AND "budget_limit"."amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
);
--> statement-breakpoint
CREATE TABLE "monthly_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"month" date NOT NULL,
	"currency" text NOT NULL,
	"planned_income" numeric NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_scope_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "budget_scope_month_currency" UNIQUE("workspace_id","month","currency"),
	CONSTRAINT "budget_first_day" CHECK (extract(day from "monthly_budget"."month")=1),
	CONSTRAINT "budget_plan_valid" CHECK ("monthly_budget"."planned_income">=0 AND "monthly_budget"."planned_income" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
	CONSTRAINT "budget_version_positive" CHECK ("monthly_budget"."version">0)
);
--> statement-breakpoint
ALTER TABLE "budget_limit" ADD CONSTRAINT "budget_limit_workspace_id_budget_id_monthly_budget_workspace_id_id_fk" FOREIGN KEY ("workspace_id","budget_id") REFERENCES "public"."monthly_budget"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limit" ADD CONSTRAINT "budget_limit_workspace_id_category_id_category_workspace_id_id_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."category"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_budget" ADD CONSTRAINT "monthly_budget_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION budget_currency_scale(code text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT CASE code WHEN 'AED' THEN 2 WHEN 'AFN' THEN 0 WHEN 'ALL' THEN 0 WHEN 'AMD' THEN 2 WHEN 'ANG' THEN 2 WHEN 'AOA' THEN 2 WHEN 'ARS' THEN 2 WHEN 'AUD' THEN 2 WHEN 'AWG' THEN 2 WHEN 'AZN' THEN 2 WHEN 'BAM' THEN 2 WHEN 'BBD' THEN 2 WHEN 'BDT' THEN 2 WHEN 'BGN' THEN 2 WHEN 'BHD' THEN 3 WHEN 'BIF' THEN 0 WHEN 'BMD' THEN 2 WHEN 'BND' THEN 2 WHEN 'BOB' THEN 2 WHEN 'BRL' THEN 2 WHEN 'BSD' THEN 2 WHEN 'BTN' THEN 2 WHEN 'BWP' THEN 2 WHEN 'BYN' THEN 2 WHEN 'BZD' THEN 2 WHEN 'CAD' THEN 2 WHEN 'CDF' THEN 2 WHEN 'CHF' THEN 2 WHEN 'CLP' THEN 0 WHEN 'CNY' THEN 2 WHEN 'COP' THEN 0 WHEN 'CRC' THEN 2 WHEN 'CUC' THEN 2 WHEN 'CUP' THEN 2 WHEN 'CVE' THEN 2 WHEN 'CZK' THEN 2 WHEN 'DJF' THEN 0 WHEN 'DKK' THEN 2 WHEN 'DOP' THEN 2 WHEN 'DZD' THEN 2 WHEN 'EGP' THEN 2 WHEN 'ERN' THEN 2 WHEN 'ETB' THEN 2 WHEN 'EUR' THEN 2 WHEN 'FJD' THEN 2 WHEN 'FKP' THEN 2 WHEN 'GBP' THEN 2 WHEN 'GEL' THEN 2 WHEN 'GHS' THEN 2 WHEN 'GIP' THEN 2 WHEN 'GMD' THEN 2 WHEN 'GNF' THEN 0 WHEN 'GTQ' THEN 2 WHEN 'GYD' THEN 2 WHEN 'HKD' THEN 2 WHEN 'HNL' THEN 2 WHEN 'HRK' THEN 2 WHEN 'HTG' THEN 2 WHEN 'HUF' THEN 0 WHEN 'IDR' THEN 0 WHEN 'ILS' THEN 2 WHEN 'INR' THEN 2 WHEN 'IQD' THEN 0 WHEN 'IRR' THEN 0 WHEN 'ISK' THEN 0 WHEN 'JMD' THEN 2 WHEN 'JOD' THEN 3 WHEN 'JPY' THEN 0 WHEN 'KES' THEN 2 WHEN 'KGS' THEN 2 WHEN 'KHR' THEN 2 WHEN 'KMF' THEN 0 WHEN 'KPW' THEN 0 WHEN 'KRW' THEN 0 WHEN 'KWD' THEN 3 WHEN 'KYD' THEN 2 WHEN 'KZT' THEN 2 WHEN 'LAK' THEN 0 WHEN 'LBP' THEN 0 WHEN 'LKR' THEN 2 WHEN 'LRD' THEN 2 WHEN 'LSL' THEN 2 WHEN 'LYD' THEN 3 WHEN 'MAD' THEN 2 WHEN 'MDL' THEN 2 WHEN 'MGA' THEN 0 WHEN 'MKD' THEN 2 WHEN 'MMK' THEN 0 WHEN 'MNT' THEN 2 WHEN 'MOP' THEN 2 WHEN 'MRU' THEN 2 WHEN 'MUR' THEN 2 WHEN 'MVR' THEN 2 WHEN 'MWK' THEN 2 WHEN 'MXN' THEN 2 WHEN 'MYR' THEN 2 WHEN 'MZN' THEN 2 WHEN 'NAD' THEN 2 WHEN 'NGN' THEN 2 WHEN 'NIO' THEN 2 WHEN 'NOK' THEN 2 WHEN 'NPR' THEN 2 WHEN 'NZD' THEN 2 WHEN 'OMR' THEN 3 WHEN 'PAB' THEN 2 WHEN 'PEN' THEN 2 WHEN 'PGK' THEN 2 WHEN 'PHP' THEN 2 WHEN 'PKR' THEN 0 WHEN 'PLN' THEN 2 WHEN 'PYG' THEN 0 WHEN 'QAR' THEN 2 WHEN 'RON' THEN 2 WHEN 'RSD' THEN 2 WHEN 'RUB' THEN 2 WHEN 'RWF' THEN 0 WHEN 'SAR' THEN 2 WHEN 'SBD' THEN 2 WHEN 'SCR' THEN 2 WHEN 'SDG' THEN 2 WHEN 'SEK' THEN 2 WHEN 'SGD' THEN 2 WHEN 'SHP' THEN 2 WHEN 'SLE' THEN 2 WHEN 'SLL' THEN 0 WHEN 'SOS' THEN 0 WHEN 'SRD' THEN 2 WHEN 'SSP' THEN 2 WHEN 'STN' THEN 2 WHEN 'SVC' THEN 2 WHEN 'SYP' THEN 0 WHEN 'SZL' THEN 2 WHEN 'THB' THEN 2 WHEN 'TJS' THEN 2 WHEN 'TMT' THEN 2 WHEN 'TND' THEN 3 WHEN 'TOP' THEN 2 WHEN 'TRY' THEN 2 WHEN 'TTD' THEN 2 WHEN 'TWD' THEN 2 WHEN 'TZS' THEN 2 WHEN 'UAH' THEN 2 WHEN 'UGX' THEN 0 WHEN 'USD' THEN 2 WHEN 'UYU' THEN 2 WHEN 'UZS' THEN 2 WHEN 'VES' THEN 2 WHEN 'VND' THEN 0 WHEN 'VUV' THEN 0 WHEN 'WST' THEN 2 WHEN 'XAF' THEN 0 WHEN 'XCD' THEN 2 WHEN 'XCG' THEN 2 WHEN 'XDR' THEN 2 WHEN 'XOF' THEN 0 WHEN 'XPF' THEN 0 WHEN 'XSU' THEN 2 WHEN 'YER' THEN 0 WHEN 'ZAR' THEN 2 WHEN 'ZMW' THEN 2 WHEN 'ZWG' THEN 2 WHEN 'ZWL' THEN 2 ELSE NULL END $$;
--> statement-breakpoint
ALTER TABLE monthly_budget ADD CONSTRAINT budget_currency_scale_valid CHECK (budget_currency_scale(currency) IS NOT NULL AND scale(planned_income)<=budget_currency_scale(currency));
--> statement-breakpoint
CREATE FUNCTION validate_budget_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c text; k text;
BEGIN
 SELECT currency INTO c FROM monthly_budget WHERE workspace_id=NEW.workspace_id AND id=NEW.budget_id;
 SELECT kind INTO k FROM category WHERE workspace_id=NEW.workspace_id AND id=NEW.category_id;
 IF c IS NULL OR k IS DISTINCT FROM 'expense' OR scale(NEW.amount)>budget_currency_scale(c) THEN RAISE EXCEPTION 'INVALID_BUDGET_LIMIT'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER budget_limit_rules BEFORE INSERT OR UPDATE ON budget_limit FOR EACH ROW EXECUTE FUNCTION validate_budget_limit();
--> statement-breakpoint
CREATE FUNCTION protect_budget_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.workspace_id,NEW.month,NEW.currency) IS DISTINCT FROM (OLD.workspace_id,OLD.month,OLD.currency) THEN RAISE EXCEPTION 'BUDGET_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER budget_identity_rules BEFORE UPDATE ON monthly_budget FOR EACH ROW EXECUTE FUNCTION protect_budget_identity();
--> statement-breakpoint
CREATE FUNCTION protect_budget_category_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind IS DISTINCT FROM OLD.kind AND EXISTS (SELECT 1 FROM budget_limit WHERE workspace_id=OLD.workspace_id AND category_id=OLD.id) THEN RAISE EXCEPTION 'BUDGET_EXPENSE_CATEGORY_REQUIRED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER budget_category_kind_rules BEFORE UPDATE ON category FOR EACH ROW EXECUTE FUNCTION protect_budget_category_kind();
