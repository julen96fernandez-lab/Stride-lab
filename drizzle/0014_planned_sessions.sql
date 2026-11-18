CREATE TABLE IF NOT EXISTS "planned_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "date" date NOT NULL,
  "kind" text NOT NULL,
  "distance_m" real,
  "duration_s" integer,
  "note" text,
  "replaces_week" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "planned_sessions_date_idx" ON "planned_sessions" ("date");
--> statement-breakpoint
ALTER TABLE "plan_weeks" ADD COLUMN IF NOT EXISTS "dismissed" boolean DEFAULT false NOT NULL;
