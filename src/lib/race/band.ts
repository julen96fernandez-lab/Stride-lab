/**
 * Banda de ritmos como imagen vertical (fondo de pantalla del iPhone). Lógica pura del
 * reparto: deja libre arriba la zona del reloj de la pantalla de bloqueo y abajo la de los
 * accesos, y ajusta el tamaño de letra para que quepan todas las filas (en 1 o 2 columnas).
 */
export const BAND_W = 1179;
export const BAND_H = 2556;
/** reloj y fecha de la pantalla de bloqueo */
export const TOP_FREE = 0.27;
/** linterna, cámara y barra de inicio */
export const BOTTOM_FREE = 0.1;
export const HEADER_H = 200;

export interface BandLayout {
  columns: 1 | 2;
  rowsPerColumn: number;
  rowH: number;
  fontPx: number;
  top: number;
  tableTop: number;
  bottom: number;
}

export function bandLayout(rows: number, w = BAND_W, h = BAND_H): BandLayout {
  const top = Math.round(h * TOP_FREE);
  const bottom = Math.round(h * (1 - BOTTOM_FREE));
  const tableTop = top + HEADER_H;
  const avail = bottom - tableTop;
  // Una columna mientras la letra no baje de 46 px; si no, dos.
  const one = avail / Math.max(1, rows);
  const columns: 1 | 2 = one >= 64 ? 1 : 2;
  const rowsPerColumn = Math.ceil(rows / columns);
  const rowH = Math.min(110, Math.floor(avail / Math.max(1, rowsPerColumn)));
  const fontPx = Math.max(30, Math.min(72, Math.floor(rowH * 0.66 * (columns === 2 ? 0.92 : 1))));
  void w;
  return { columns, rowsPerColumn, rowH, fontPx, top, tableTop, bottom };
}
