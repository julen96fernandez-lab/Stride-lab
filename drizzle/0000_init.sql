CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_samples" (
	"import_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"seq" integer NOT NULL,
	"t" integer[] NOT NULL,
	"v" real[] NOT NULL,
	CONSTRAINT "import_samples_import_id_run_id_metric_seq_pk" PRIMARY KEY("import_id","run_id","metric","seq")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_url" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"file_name" text,
	"file_size" bigint,
	"export_date" timestamp with time zone,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"phase" text DEFAULT 'index' NOT NULL,
	"bytes_processed" bigint DEFAULT 0 NOT NULL,
	"bytes_total" bigint,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_routes" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"blob_url" text NOT NULL,
	"file_name" text NOT NULL,
	"point_count" integer,
	"polyline" text,
	"min_lat" double precision,
	"min_lon" double precision,
	"max_lat" double precision,
	"max_lon" double precision,
	"gpx_distance_m" real,
	"gpx_elevation_gain_m" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_series" (
	"run_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"t" integer[] NOT NULL,
	"v" real[] NOT NULL,
	CONSTRAINT "run_series_run_id_metric_pk" PRIMARY KEY("run_id","metric")
);
--> statement-breakpoint
CREATE TABLE "run_splits" (
	"run_id" uuid NOT NULL,
	"idx" smallint NOT NULL,
	"distance_m" real NOT NULL,
	"duration_s" real NOT NULL,
	"pace_s_per_km" real,
	"avg_hr" real,
	"avg_power_w" real,
	"elevation_gain_m" real,
	"elevation_loss_m" real,
	"basis" text NOT NULL,
	CONSTRAINT "run_splits_run_id_idx_pk" PRIMARY KEY("run_id","idx")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"source" text NOT NULL,
	"source_name" text,
	"source_version" text,
	"device" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"duration_s" real NOT NULL,
	"distance_m" real,
	"avg_pace_s_per_km" real,
	"avg_hr" real,
	"max_hr" real,
	"avg_power_w" real,
	"avg_speed_mps" real,
	"avg_stride_m" real,
	"avg_vertical_osc_cm" real,
	"avg_ground_contact_ms" real,
	"steps" integer,
	"cadence_spm" real,
	"elevation_gain_m" real,
	"temperature_c" real,
	"humidity_pct" real,
	"is_indoor" boolean,
	"active_energy_kcal" real,
	"route_file" text,
	"status" text DEFAULT 'valid' NOT NULL,
	"invalid_reason" text,
	"duplicate_of" uuid,
	"is_special" boolean DEFAULT false NOT NULL,
	"shoe_id" uuid,
	"import_id" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"model" text,
	"purchased_at" date,
	"retired_at" date,
	"initial_km" real DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vo2max_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"value" real NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_samples" ADD CONSTRAINT "import_samples_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_samples" ADD CONSTRAINT "import_samples_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_routes" ADD CONSTRAINT "run_routes_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_series" ADD CONSTRAINT "run_series_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_splits" ADD CONSTRAINT "run_splits_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_duplicate_of_runs_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_shoe_id_shoes_id_fk" FOREIGN KEY ("shoe_id") REFERENCES "public"."shoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vo2max_readings" ADD CONSTRAINT "vo2max_readings_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_source_key_uq" ON "runs" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "runs_start_at_idx" ON "runs" USING btree ("start_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status","is_special");--> statement-breakpoint
CREATE UNIQUE INDEX "vo2max_measured_source_uq" ON "vo2max_readings" USING btree ("measured_at","source_name");--> statement-breakpoint
CREATE INDEX "vo2max_measured_idx" ON "vo2max_readings" USING btree ("measured_at");