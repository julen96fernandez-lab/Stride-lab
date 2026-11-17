/**
 * Escáner en streaming de export.xml a nivel de bytes.
 *
 * No parsea el XML entero: busca con Buffer.indexOf (nativo) los inicios de los
 * elementos que interesan y solo convierte a texto esos fragmentos. Mantiene un
 * «arrastre» con el elemento incompleto al final de cada trozo, y expone
 * `safeOffset`: el byte del XML descomprimido a partir del cual se puede reanudar
 * sin perder ni duplicar elementos.
 */

export interface ScanTarget {
  /** Identificador devuelto en cada coincidencia. */
  id: string;
  /** Inicio literal del elemento, p. ej. `<Workout ` o `<Record type="HKQuantityTypeIdentifierVO2Max"`. */
  start: string;
  /** Si es true se captura hasta `</name>` (o `/>`); si no, solo la etiqueta de apertura. */
  block?: { close: string };
}

export interface ScanMatch {
  id: string;
  text: string;
  /** Byte (en el XML descomprimido) donde empieza el elemento. */
  offset: number;
}

const MIN_PROCESS = 1 << 20; // procesa en bloques de ≥1 MB

export class XmlScanner {
  private carry: Buffer = Buffer.alloc(0);
  private carryOffset: number;
  private pending: Buffer[] = [];
  private pendingLen = 0;
  private readonly starts: Buffer[];
  private readonly closes: (Buffer | null)[];
  private readonly maxStartLen: number;
  private readonly gt = 0x3e; // '>'
  private readonly slash = 0x2f; // '/'

  constructor(
    private readonly targets: ScanTarget[],
    /** Offset del primer byte que se va a recibir. */
    startOffset = 0,
    /** Tamaño mínimo acumulado antes de procesar (configurable para pruebas). */
    private readonly minProcess = MIN_PROCESS,
  ) {
    this.carryOffset = startOffset;
    this.starts = targets.map((t) => Buffer.from(t.start, "utf8"));
    this.closes = targets.map((t) => (t.block ? Buffer.from(t.block.close, "utf8") : null));
    this.maxStartLen = Math.max(...this.starts.map((s) => s.length));
  }

  /** Primer byte todavía no consumido: punto de reanudación seguro. */
  get safeOffset(): number {
    return this.carryOffset;
  }

  push(chunk: Uint8Array, onMatch: (m: ScanMatch) => void): void {
    this.pending.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    this.pendingLen += chunk.byteLength;
    if (this.pendingLen >= this.minProcess) this.process(onMatch);
  }

  /** Procesa lo que quede (al terminar el stream o antes de guardar un punto de control). */
  flush(onMatch: (m: ScanMatch) => void): void {
    this.process(onMatch);
  }

  private process(onMatch: (m: ScanMatch) => void): void {
    if (this.pendingLen === 0) return;
    const buf = this.carry.length
      ? Buffer.concat([this.carry, ...this.pending], this.carry.length + this.pendingLen)
      : this.pending.length === 1
        ? this.pending[0]
        : Buffer.concat(this.pending, this.pendingLen);
    this.pending = [];
    this.pendingLen = 0;
    const base = this.carryOffset;

    const next = this.starts.map((s) => buf.indexOf(s, 0));
    let pos = 0;
    let keepFrom = -1;

    for (;;) {
      // Siguiente coincidencia más cercana.
      let k = -1;
      let at = Infinity;
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== -1 && next[i] < at) {
          at = next[i];
          k = i;
        }
      }
      if (k === -1) break;

      const close = this.closes[k];
      const tagEnd = buf.indexOf(this.gt, at);
      let end = -1;
      if (tagEnd !== -1) {
        if (!close || buf[tagEnd - 1] === this.slash) end = tagEnd + 1;
        else {
          const c = buf.indexOf(close, tagEnd);
          if (c !== -1) end = c + close.length;
        }
      }
      if (end === -1) {
        keepFrom = at; // elemento incompleto: se reintenta con el siguiente trozo
        break;
      }
      onMatch({ id: this.targets[k].id, text: buf.toString("utf8", at, end), offset: base + at });
      pos = end;
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== -1 && next[i] < pos) next[i] = buf.indexOf(this.starts[i], pos);
      }
    }

    if (keepFrom === -1) {
      // Conserva la cola por si contiene el principio de un patrón partido.
      keepFrom = Math.max(pos, buf.length - (this.maxStartLen - 1));
    }
    this.carry = Buffer.from(buf.subarray(keepFrom)); // copia: libera el búfer grande
    this.carryOffset = base + keepFrom;
  }
}
