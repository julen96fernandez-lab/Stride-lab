CREATE TABLE IF NOT EXISTS "health_scans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL,
  "blob_url" text NOT NULL,
  "blob_pathname" text NOT NULL,
  "export_date" timestamp with time zone,
  "status" text DEFAULT 'pending' NOT NULL,
  "bytes_processed" bigint DEFAULT 0 NOT NULL,
  "bytes_total" bigint,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "census" jsonb,
  "error" text,
  "lease_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
