import { describe, expect, it } from "vitest";
import { choiceMatches, choiceUrl, choicesFromParams } from "@/lib/ui/choice";

const spec = { vista: { default: "semana", options: ["semana", "mes", "año"] }, cal: { default: "km", options: ["km", "carga"] } };

describe("selectores en el cliente", () => {
  it("lee la URL y descarta valores no válidos", () => {
    expect(choicesFromParams({ vista: "mes", cal: "raro" }, spec)).toEqual({ vista: "mes", cal: "km" });
    expect(choicesFromParams({}, spec)).toEqual({ vista: "semana", cal: "km" });
    expect(choicesFromParams({ vista: ["mes", "año"] }, spec)).toEqual({ vista: "semana", cal: "km" });
  });
  it("escribe en la URL solo lo distinto de lo por defecto y conserva el resto", () => {
    const d = { vista: "semana", cal: "km" };
    expect(choiceUrl("https://a/analisis?otro=1#forma", { vista: "mes", cal: "km" }, d)).toBe("/analisis?otro=1&vista=mes#forma");
    expect(choiceUrl("https://a/analisis?vista=mes", { vista: "semana", cal: "km" }, d)).toBe("/analisis");
    expect(choiceUrl("https://a/analisis", { vista: "año", cal: "carga" }, d)).toBe("/analisis?vista=a%C3%B1o&cal=carga");
  });
  it("un panel se enseña si coinciden todas sus condiciones", () => {
    expect(choiceMatches({ vista: "semana", semanas: "26" }, { vista: "semana", semanas: "26" })).toBe(true);
    expect(choiceMatches({ vista: "mes", semanas: "26" }, { vista: "semana", semanas: "26" })).toBe(false);
  });
});
