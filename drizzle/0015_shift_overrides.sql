CREATE TABLE IF NOT EXISTS "shift_overrides" (
  "date" date PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
