CREATE TABLE "run_tracks" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"t" real[] NOT NULL,
	"lat" double precision[] NOT NULL,
	"lon" double precision[] NOT NULL,
	"ele" real[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_tracks" ADD CONSTRAINT "run_tracks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;