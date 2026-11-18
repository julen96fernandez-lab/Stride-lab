CREATE TABLE IF NOT EXISTS "run_feelings" (
  "run_id" uuid PRIMARY KEY NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "rating" smallint CHECK ("rating" BETWEEN 1 AND 5),
  "note" text CHECK (char_length("note") <= 500),
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- La «Nota» de las carreras manuales pasa a la nota de Sensaciones (hoy no hay ninguna).
INSERT INTO "run_feelings" ("run_id", "note")
SELECT "id", left("note", 500) FROM "runs" WHERE "note" IS NOT NULL AND btrim("note") <> ''
ON CONFLICT ("run_id") DO NOTHING;
