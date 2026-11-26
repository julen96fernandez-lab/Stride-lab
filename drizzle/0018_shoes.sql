ALTER TABLE "shoes" ADD COLUMN IF NOT EXISTS "limit_km" real DEFAULT 700 NOT NULL;
--> statement-breakpoint
ALTER TABLE "shoes" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "shoes" ADD COLUMN IF NOT EXISTS "count_treadmill" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "shoes" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_shoes" (
  "run_id" uuid PRIMARY KEY NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "shoe_id" uuid NOT NULL REFERENCES "shoes"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_shoes_shoe_idx" ON "run_shoes" ("shoe_id");
--> statement-breakpoint
INSERT INTO "run_shoes" ("run_id", "shoe_id") SELECT "id", "shoe_id" FROM "runs" WHERE "shoe_id" IS NOT NULL ON CONFLICT DO NOTHING;
