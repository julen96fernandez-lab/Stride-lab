CREATE TABLE IF NOT EXISTS "race_goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "date" date NOT NULL,
  "distance_key" text NOT NULL,
  "distance_m" real NOT NULL,
  "start_time" text,
  "target_s" real NOT NULL,
  "strategy" text DEFAULT 'even' NOT NULL,
  "profile" jsonb,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
