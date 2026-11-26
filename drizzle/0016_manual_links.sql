ALTER TABLE "planned_sessions" ADD COLUMN IF NOT EXISTS "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN IF NOT EXISTS "unlinked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_weeks" ADD COLUMN IF NOT EXISTS "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "plan_weeks" ADD COLUMN IF NOT EXISTS "unlinked" boolean DEFAULT false NOT NULL;
