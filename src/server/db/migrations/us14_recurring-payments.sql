CREATE TABLE obligation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspace(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), amount numeric NOT NULL,
 currency text NOT NULL, repeat_every integer NOT NULL CHECK(repeat_every>0),
 repeat_unit text NOT NULL CHECK(repeat_unit IN ('day','week','month','year')),
 anchor_date date NOT NULL CHECK(isfinite(anchor_date)), anchor_day integer NOT NULL CHECK(anchor_day=extract(day from anchor_date)),
 category_id uuid NOT NULL, account_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,id,currency),
 FOREIGN KEY(workspace_id,account_id,currency) REFERENCES financial_account(workspace_id,id,currency),
 FOREIGN KEY(workspace_id,category_id) REFERENCES category(workspace_id,id),
 CHECK(amount>=0 AND amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
);
CREATE TABLE obligation_schedule_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, obligation_id uuid NOT NULL,
 revision_no integer NOT NULL CHECK(revision_no>0), anchor_date date NOT NULL CHECK(isfinite(anchor_date)),
 anchor_day integer NOT NULL CHECK(anchor_day=extract(day from anchor_date)),
 repeat_every integer NOT NULL CHECK(repeat_every>0), repeat_unit text NOT NULL CHECK(repeat_unit IN ('day','week','month','year')),
 amount numeric NOT NULL CHECK(amount>=0 AND amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
 currency text NOT NULL, active_from date NOT NULL CHECK(isfinite(active_from)), active_until date,
 status text NOT NULL CHECK(status IN ('active','paused','archived')), recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(obligation_id,revision_no), FOREIGN KEY(workspace_id,obligation_id,currency) REFERENCES obligation(workspace_id,id,currency),
 CHECK(active_until IS NULL OR (isfinite(active_until) AND active_until>=active_from))
);
CREATE TABLE obligation_occurrence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, obligation_id uuid NOT NULL,
 scheduled_date date NOT NULL CHECK(isfinite(scheduled_date)), scheduled_amount numeric NOT NULL,
 currency text NOT NULL, source_version integer NOT NULL CHECK(source_version>0),
 status text NOT NULL DEFAULT 'planned', payment_action_id uuid REFERENCES financial_action(id),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,obligation_id,currency) REFERENCES obligation(workspace_id,id,currency),
 FOREIGN KEY(obligation_id,source_version) REFERENCES obligation_schedule_revision(obligation_id,revision_no),
 CHECK(scheduled_amount>=0 AND scheduled_amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
 CHECK((status='paid' AND payment_action_id IS NOT NULL) OR (status IN ('planned','superseded') AND payment_action_id IS NULL))
);
CREATE UNIQUE INDEX occurrence_one_date ON obligation_occurrence(obligation_id,scheduled_date) WHERE status<>'superseded';
CREATE UNIQUE INDEX occurrence_one_payment ON obligation_occurrence(payment_action_id) WHERE status='paid';
ALTER TABLE reserve_settings DROP CONSTRAINT reserve_link_unavailable;
ALTER TABLE reserve_settings ADD CONSTRAINT reserve_obligation_scope FOREIGN KEY(workspace_id,linked_obligation_id) REFERENCES obligation(workspace_id,id);
CREATE FUNCTION guard_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.workspace_id<>OLD.workspace_id OR NEW.currency<>OLD.currency) THEN RAISE EXCEPTION 'IMMUTABLE_SCOPE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM category WHERE id=NEW.category_id AND workspace_id=NEW.workspace_id AND kind='expense') THEN RAISE EXCEPTION 'INVALID_CATEGORY'; END IF;
 IF budget_currency_scale(NEW.currency) IS NULL OR scale(NEW.amount)>budget_currency_scale(NEW.currency) THEN RAISE EXCEPTION 'INVALID_MONEY'; END IF;
 IF EXISTS(SELECT 1 FROM reserve_settings WHERE linked_obligation_id=NEW.id) AND (NEW.repeat_unit<>'month' OR NEW.repeat_every<>1) THEN RAISE EXCEPTION 'INVALID_RESERVE_LINK'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER obligation_guard BEFORE INSERT OR UPDATE ON obligation FOR EACH ROW EXECUTE FUNCTION guard_obligation();
CREATE FUNCTION guard_reserve_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.linked_obligation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM obligation o JOIN goal g ON g.id=NEW.goal_id AND g.workspace_id=NEW.workspace_id WHERE o.id=NEW.linked_obligation_id AND o.workspace_id=NEW.workspace_id AND o.currency=g.currency AND g.type='reserve' AND o.repeat_unit='month' AND o.repeat_every=1) THEN RAISE EXCEPTION 'INVALID_RESERVE_LINK'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reserve_obligation_guard BEFORE INSERT OR UPDATE ON reserve_settings FOR EACH ROW EXECUTE FUNCTION guard_reserve_obligation();
CREATE FUNCTION immutable_obligation_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_SCHEDULE'; END $$;
CREATE TRIGGER obligation_schedule_immutable BEFORE UPDATE OR DELETE ON obligation_schedule_revision FOR EACH ROW EXECUTE FUNCTION immutable_obligation_revision();
CREATE FUNCTION guard_obligation_occurrence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_OCCURRENCE'; END IF;
 IF budget_currency_scale(NEW.currency) IS NULL OR scale(NEW.scheduled_amount)>budget_currency_scale(NEW.currency) THEN RAISE EXCEPTION 'INVALID_MONEY'; END IF;
 IF TG_OP='UPDATE' AND (NEW.workspace_id,NEW.obligation_id,NEW.scheduled_date,NEW.scheduled_amount,NEW.currency,NEW.source_version) IS DISTINCT FROM (OLD.workspace_id,OLD.obligation_id,OLD.scheduled_date,OLD.scheduled_amount,OLD.currency,OLD.source_version) THEN RAISE EXCEPTION 'IMMUTABLE_SNAPSHOT'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='paid' AND (NEW.status,NEW.payment_action_id) IS DISTINCT FROM (OLD.status,OLD.payment_action_id) AND EXISTS(SELECT 1 FROM financial_action WHERE id=OLD.payment_action_id AND status='active') THEN RAISE EXCEPTION 'IMMUTABLE_PAYMENT'; END IF;
 IF NEW.status='paid' AND NOT EXISTS(SELECT 1 FROM financial_action a JOIN ledger_leg l ON l.action_id=a.id AND l.revision_no=a.current_revision WHERE a.id=NEW.payment_action_id AND a.kind='expense' AND a.status='active' AND l.workspace_id=NEW.workspace_id AND l.currency=NEW.currency AND l.role='expense') THEN RAISE EXCEPTION 'INVALID_PAYMENT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER occurrence_guard BEFORE INSERT OR UPDATE OR DELETE ON obligation_occurrence FOR EACH ROW EXECUTE FUNCTION guard_obligation_occurrence();
CREATE FUNCTION reopen_deleted_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='deleted' THEN UPDATE obligation_occurrence SET status='planned',payment_action_id=NULL WHERE payment_action_id=NEW.id; END IF; RETURN NEW;
END $$;
CREATE TRIGGER obligation_payment_deleted AFTER UPDATE OF status ON financial_action FOR EACH ROW EXECUTE FUNCTION reopen_deleted_payment();
