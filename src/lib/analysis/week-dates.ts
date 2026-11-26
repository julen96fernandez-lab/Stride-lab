/** Fechas AAAA-MM-DD (UTC, sin horas): sumar días y lunes de la semana. */
export const addDaysYmd = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const mondayOf = (ymd: string) => addDaysYmd(ymd, -((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7));
