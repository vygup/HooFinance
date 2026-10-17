CREATE TABLE savings_plan (
  workspace_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  anchor_date date NOT NULL,
  anchor_day integer NOT NULL,
  monthly_contribution numeric,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT savings_plan_one_goal UNIQUE (workspace_id, goal_id),
  CONSTRAINT savings_plan_scope_fk FOREIGN KEY (workspace_id, goal_id) REFERENCES goal(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT savings_plan_anchor_day CHECK (anchor_day=extract(day from anchor_date) AND anchor_day BETWEEN 1 AND 31),
  CONSTRAINT savings_plan_amount CHECK (monthly_contribution IS NULL OR (monthly_contribution>=0 AND monthly_contribution NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))),
  CONSTRAINT savings_plan_version CHECK (version>0)
);
