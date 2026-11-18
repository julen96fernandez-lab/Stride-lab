import { describe, expect, it } from "vitest";
import {
  ANIMATION,
  BAR_RADIUS,
  LABEL_SIZE,
  LINE_WIDTH,
  alpha,
  barItem,
  barSeries,
  categoryAxis,
  fade,
  lineSeries,
  refLine,
  tooltip,
  tooltipPosition,
  valueAxis,
  withIds,
} from "@/components/charts/theme";

describe("estilo común de los gráficos", () => {
  it("colores del tema con transparencia", () => {
    expect(alpha("var(--chart-line)", 0.3)).toBe("alpha(var(--chart-line),0.3)");
    expect(alpha("var(--fg)", 2)).toBe("alpha(var(--fg),1)");
    expect(alpha("#fff", 0.5)).toBe("#fff"); // solo variables del tema
  });

  it("líneas de 2 px suaves, redondeadas y sin puntos en cada muestra", () => {
    const l = lineSeries({ data: [] });
    expect(l.lineStyle).toMatchObject({ width: LINE_WIDTH, cap: "round", join: "round" });
    expect(l.smooth).toBeGreaterThan(0);
    expect(l.showSymbol).toBe(false);
    expect(l.connectNulls).toBe(false);
    expect(l.emphasis.itemStyle.shadowBlur).toBeGreaterThan(0); // punto con brillo en el cursor
    expect(lineSeries({ data: [], step: "end" }).smooth).toBe(false);
    expect(lineSeries({ data: [], points: true }).showSymbol).toBe(true);
  });

  it("relleno con degradado transparente que se desvanece", () => {
    const l = lineSeries({ data: [], area: true });
    const stops = l.areaStyle!.color.colorStops;
    expect(stops[0].color).toMatch(/^alpha\(var\(--chart-line\),0\.\d+\)$/);
    expect(stops.at(-1)!.color).toBe("alpha(var(--chart-line),0)");
    expect(fade("var(--z4)").y2).toBe(1); // vertical
  });

  it("barras: esquinas superiores redondeadas, degradado, espacio y la actual con brillo", () => {
    expect(BAR_RADIUS.slice(0, 2)).toEqual([6, 6]);
    const b = barItem({});
    expect(b.borderRadius).toEqual(BAR_RADIUS);
    expect(b.color.colorStops).toHaveLength(2);
    const cur = barItem({ current: true });
    expect(cur.color.colorStops[0].color).toBe("var(--chart-line)");
    expect(cur.shadowBlur).toBeGreaterThan(0);
    expect(barItem({ top: false }).borderRadius).toBe(0); // capas intermedias de una pila
    expect(parseInt(barSeries({ data: [] }).barCategoryGap)).toBeGreaterThanOrEqual(30);
  });

  it("ejes: etiquetas pequeñas y tenues, sin líneas, rejilla muy suave", () => {
    const y = valueAxis();
    expect(y.axisLine.show).toBe(false);
    expect(y.axisTick.show).toBe(false);
    expect(y.axisLabel).toMatchObject({ fontSize: LABEL_SIZE, color: "var(--fg-2)", hideOverlap: true });
    expect(y.splitLine.lineStyle.color).toMatch(/^alpha\(var\(--fg\),0\.0\d\)$/);
    expect(valueAxis({ interval: 30 }).splitNumber).toBeUndefined(); // marcas regulares
    expect(categoryAxis(["a"], { every: 3 }).axisLabel.interval).toBe(2);
  });

  it("objetivos y medias: línea fina discontinua con la etiqueta a un lado", () => {
    const r = refLine({ value: 40, label: "Objetivo 40 km", side: "start" });
    expect(r.lineStyle.width).toBe(1);
    expect(r.lineStyle.type).toEqual([4, 4]);
    expect(r.label).toMatchObject({ position: "insideStartTop", fontSize: LABEL_SIZE });
    expect(refLine({ value: 1 }).label.show).toBe(false);
  });

  it("tooltip único: compacto, desenfocado, nunca encima del dedo", () => {
    const t = tooltip();
    expect(t.confine).toBe(true);
    expect(t.extraCssText).toMatch(/backdrop-filter/);
    const size = { contentSize: [120, 50] as [number, number], viewSize: [360, 200] as [number, number] };
    // Encima del dedo y a la derecha.
    expect(tooltipPosition([100, 150], size)).toEqual([114, 86]);
    // Sin sitio a la derecha: a la izquierda.
    const [x] = tooltipPosition([330, 150], size);
    expect(x + 120).toBeLessThanOrEqual(330 - 14);
    // Sin sitio encima: debajo, sin tapar el punto.
    const [, y] = tooltipPosition([100, 20], size);
    expect(y).toBeGreaterThanOrEqual(20 + 14);
  });

  it("animación de entrada suave; las actualizaciones, más cortas", () => {
    expect(ANIMATION.animationDuration).toBeGreaterThan(ANIMATION.animationDurationUpdate);
    expect(ANIMATION.animationEasing).toBe("cubicOut");
  });

  it("ids estables por posición: actualizar sin recrear (sin repetir la animación de entrada)", () => {
    const o = withIds({ series: [{ type: "line" }, { type: "bar", id: "x" }], xAxis: { type: "value" }, yAxis: [{}, {}] });
    expect((o.series as { id: string }[]).map((x) => x.id)).toEqual(["series-0", "x"]);
    expect((o.xAxis as { id: string }).id).toBe("xAxis-0");
    expect((o.yAxis as { id: string }[])[1].id).toBe("yAxis-1");
    expect(withIds({ series: [{ type: "line" }] })).toEqual(withIds({ series: [{ type: "line" }] })); // determinista
  });
});
