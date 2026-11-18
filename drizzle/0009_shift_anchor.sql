-- Ciclo de turnos: lunes de inicio de un bloque de tardes (lunes 23-nov-2026).
INSERT INTO app_settings (key, value) VALUES ('shift_anchor', '2026-11-23') ON CONFLICT (key) DO NOTHING;
