-- La nota de las carreras vive ahora en run_feelings. Por si quedara alguna, se copia antes.
INSERT INTO "run_feelings" ("run_id", "note")
SELECT "id", left("note", 500) FROM "runs" WHERE "note" IS NOT NULL AND btrim("note") <> ''
ON CONFLICT ("run_id") DO UPDATE SET "note" = COALESCE("run_feelings"."note", EXCLUDED."note");--> statement-breakpoint
ALTER TABLE "runs" DROP COLUMN IF EXISTS "note";
