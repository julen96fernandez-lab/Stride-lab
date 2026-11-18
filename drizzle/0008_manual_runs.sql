ALTER TABLE "runs" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "load_estimated" boolean DEFAULT false NOT NULL;