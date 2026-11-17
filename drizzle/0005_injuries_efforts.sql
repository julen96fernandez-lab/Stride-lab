CREATE TABLE "injuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_efforts" (
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"distance_m" real NOT NULL,
	"time_s" real NOT NULL,
	"start_s" real NOT NULL,
	CONSTRAINT "run_efforts_run_id_key_pk" PRIMARY KEY("run_id","key")
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "in_injury" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "run_efforts" ADD CONSTRAINT "run_efforts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_efforts_key_time_idx" ON "run_efforts" USING btree ("key","time_s");