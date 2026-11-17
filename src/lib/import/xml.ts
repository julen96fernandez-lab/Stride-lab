/** Utilidades mínimas para los elementos de export.xml (atributos entre comillas dobles). */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Atributos de la etiqueta de apertura que empieza en `tag` (hasta el primer «>»). */
export function parseAttrs(tag: string): Record<string, string> {
  const end = tag.indexOf(">");
  const head = end === -1 ? tag : tag.slice(0, end);
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) out[m[1]] = decodeEntities(m[2]);
  return out;
}

/** Lee un atributo concreto sin parsear la etiqueta entera (camino rápido). */
export function attr(tag: string, name: string): string | undefined {
  const key = ` ${name}="`;
  const i = tag.indexOf(key);
  if (i === -1) return undefined;
  const start = i + key.length;
  const end = tag.indexOf('"', start);
  return end === -1 ? undefined : decodeEntities(tag.slice(start, end));
}

/** Todas las etiquetas `<name …>` dentro de un fragmento, como mapas de atributos. */
export function childTags(xml: string, name: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const open = `<${name} `;
  let i = xml.indexOf(open);
  while (i !== -1) {
    const end = xml.indexOf(">", i);
    if (end === -1) break;
    out.push(parseAttrs(xml.slice(i, end + 1)));
    i = xml.indexOf(open, end);
  }
  return out;
}

/** "2026-10-17 09:09:00 +0200" → Date. Devuelve null si no se reconoce. */
export function parseHealthDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-])(\d{2}):?(\d{2})$/.exec(s.trim());
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
  return Number.isNaN(d.getTime()) ? null : d;
}
