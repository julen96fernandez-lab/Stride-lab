ALTER TABLE "run_efforts" ADD COLUMN IF NOT EXISTS "max_gap_s" real;
--> statement-breakpoint
UPDATE "run_efforts" e SET "max_gap_s" = (
  SELECT COALESCE(MAX(x.t - x.prev), 0) FROM (
    SELECT u.tt AS t, LAG(u.tt) OVER (ORDER BY u.o) AS prev
    FROM "run_series" s, unnest(s.t) WITH ORDINALITY AS u(tt, o)
    WHERE s.run_id = e.run_id AND s.metric = 'distance'
  ) x
  WHERE x.prev IS NOT NULL AND x.t > e.start_s AND x.prev < e.start_s + e.time_s
) WHERE "max_gap_s" IS NULL;
