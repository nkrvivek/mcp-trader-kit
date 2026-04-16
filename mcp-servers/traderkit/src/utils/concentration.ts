export type ConcentrationLabel = "HEADROOM" | "AT-CAP" | "NEAR-CAP" | "OVER-CAP";

export function concentrationLabel(pct: number, cap: number): ConcentrationLabel {
  if (pct > cap) return "OVER-CAP";
  if (pct > cap * 0.9) return "NEAR-CAP";
  if (pct > cap * 0.75) return "AT-CAP";
  return "HEADROOM";
}
