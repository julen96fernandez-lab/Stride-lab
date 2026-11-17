-- Tirada larga por defecto desde 13 km: si el ajuste guardado era el antiguo valor por defecto (15), pasa a 13.
UPDATE "app_settings"
SET "value" = jsonb_set("value"::jsonb, '{longRunKm}', '13')::text, "updated_at" = now()
WHERE "key" = 'session_type_settings' AND ("value"::jsonb->>'longRunKm')::numeric = 15;
