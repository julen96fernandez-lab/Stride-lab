CREATE TABLE IF NOT EXISTS "plan_weeks" (
  "week_start" date PRIMARY KEY NOT NULL,
  "shift_kind" text NOT NULL,
  "session" text NOT NULL,
  "day" date NOT NULL,
  "when_text" text,
  "reason" text NOT NULL,
  "downgraded" boolean DEFAULT false NOT NULL,
  "rescheduled_from" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
