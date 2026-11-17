// Medición local, fuera de la suite: PERF=1 npx vitest run
import { Readable } from "node:stream";
import { createDeflateRaw } from "node:zlib";
import { it } from "vitest";
import { XmlScanner } from "@/lib/import/scanner";
import { attr, parseHealthDate } from "@/lib/import/xml";

it("rendimiento del escáner", async () => {
  const line = (i: number) =>
    `<Record type="HKQuantityTypeIdentifier${i % 3 ? "HeartRate" : "StepCount"}" sourceName="Apple Watch de Prueba" sourceVersion="11.0" device="&lt;&lt;HKDevice: 0x1&gt;, name:Apple Watch&gt;" unit="count/min" creationDate="2025-01-01 10:00:00 +0100" startDate="2025-01-01 10:00:${String(i % 60).padStart(2, "0")} +0100" endDate="2025-01-01 10:00:00 +0100" value="${60 + (i % 90)}"/>\n`;
  const chunk = Buffer.from(Array.from({ length: 5000 }, (_, i) => line(i)).join(""));
  const reps = Math.ceil((400 * 2 ** 20) / chunk.length); // ~400 MB
  const total = chunk.length * reps;

  // 1) Comprimido + descompresión + escaneo «workouts» (casi todo se salta).
  const deflated: Buffer[] = [];
  await new Promise<void>((res) => {
    const d = createDeflateRaw();
    d.on("data", (b) => deflated.push(b)).on("end", res);
    for (let r = 0; r < reps; r++) d.write(chunk);
    d.end();
  });
  const { createInflateRaw } = await import("node:zlib");
  const run = async (targets: ConstructorParameters<typeof XmlScanner>[0], heavy: boolean) => {
    const t0 = performance.now();
    const inflate = Readable.from(deflated).pipe(createInflateRaw({ chunkSize: 256 * 1024 }));
    const sc = new XmlScanner(targets);
    let n = 0;
    const on = (m: { text: string }) => {
      n++;
      if (heavy && attr(m.text, "sourceName") === "Apple Watch de Prueba") parseHealthDate(attr(m.text, "startDate"));
    };
    for await (const b of inflate) sc.push(b, on);
    sc.flush(on);
    const s = (performance.now() - t0) / 1000;
    return { s, n, mbps: total / 2 ** 20 / s };
  };
  const w = await run([{ id: "w", start: "<Workout ", block: { close: "</Workout>" } }, { id: "v", start: '<Record type="HKQuantityTypeIdentifierVO2Max"' }], false);
  const smp = await run([{ id: "hr", start: '<Record type="HKQuantityTypeIdentifierHeartRate"' }], true);
  const est = (mbps: number) => ((3.7 * 1024) / mbps).toFixed(0);
  console.log(`XML ${(total / 2 ** 20).toFixed(0)} MB, comprimido ${(deflated.reduce((a, b) => a + b.length, 0) / 2 ** 20).toFixed(0)} MB`);
  console.log(`workouts: ${w.mbps.toFixed(0)} MB/s → 3,7 GB ≈ ${est(w.mbps)} s`);
  console.log(`samples (todo FC del reloj, peor caso): ${smp.n} registros, ${smp.mbps.toFixed(0)} MB/s → 3,7 GB ≈ ${est(smp.mbps)} s`);
}, 600_000);
