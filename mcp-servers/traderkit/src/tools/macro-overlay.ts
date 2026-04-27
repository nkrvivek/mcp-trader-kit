import { z } from "zod";
import { round } from "../utils/math.js";

export const MacroOverlayArgs = z.object({
  dxy_spot: z.number().positive(),
  dxy_50dma: z.number().positive(),
  dxy_200dma: z.number().positive(),
  hyg_lqd_ratio: z.number().positive(),
  hyg_lqd_20dma: z.number().positive(),
  vix_spot: z.number().positive().optional(),
  vix_term_slope: z.number().optional(),
  spy_spot: z.number().positive().optional(),
  spy_200dma: z.number().positive().optional(),
});

type MacroBias = "BULL" | "NEUTRAL" | "BEAR";
type TailRisk = "NONE" | "ELEVATED" | "EXTREME";

interface SectorOverlay {
  sector: string;
  bias: MacroBias;
  rationale: string;
}

function dxyTrend(spot: number, ma50: number, ma200: number): "RISING" | "FALLING" | "FLAT" {
  if (spot > ma50 && ma50 > ma200) return "RISING";
  if (spot < ma50 && ma50 < ma200) return "FALLING";
  return "FLAT";
}

function spreadDirection(ratio: number, ma20: number): "WIDENING" | "TIGHTENING" | "FLAT" {
  const pct = (ratio - ma20) / ma20;
  if (pct >= 0.005) return "TIGHTENING";
  if (pct <= -0.005) return "WIDENING";
  return "FLAT";
}

export async function macroOverlayHandler(raw: unknown) {
  const args = MacroOverlayArgs.parse(raw);
  const dollar = dxyTrend(args.dxy_spot, args.dxy_50dma, args.dxy_200dma);
  const credit = spreadDirection(args.hyg_lqd_ratio, args.hyg_lqd_20dma);

  let bias: MacroBias;
  if (dollar === "FALLING" && credit === "TIGHTENING") bias = "BULL";
  else if (dollar === "RISING" && credit === "WIDENING") bias = "BEAR";
  else bias = "NEUTRAL";

  let tailRisk: TailRisk = "NONE";
  if (args.vix_spot !== undefined) {
    if (args.vix_spot >= 30) tailRisk = "EXTREME";
    else if (args.vix_spot >= 22) tailRisk = "ELEVATED";
  }
  if (args.vix_term_slope !== undefined && args.vix_term_slope < 0) {
    tailRisk = tailRisk === "NONE" ? "ELEVATED" : "EXTREME";
  }
  if (credit === "WIDENING") {
    tailRisk = tailRisk === "NONE" ? "ELEVATED" : tailRisk;
  }

  let regimeModifier: number;
  if (bias === "BULL") regimeModifier = 1.0;
  else if (bias === "BEAR") regimeModifier = 0.5;
  else regimeModifier = 0.75;
  if (tailRisk === "EXTREME") regimeModifier = Math.min(regimeModifier, 0.25);
  else if (tailRisk === "ELEVATED") regimeModifier = Math.min(regimeModifier, 0.5);

  const sectorOverlay: SectorOverlay[] = [];
  if (dollar === "FALLING") {
    sectorOverlay.push({ sector: "commodities", bias: "BULL",
      rationale: "weaker dollar → commodity tailwind (XLE/GDX/SLV)" });
    sectorOverlay.push({ sector: "EM_equities", bias: "BULL",
      rationale: "weaker dollar → EM tailwind" });
  } else if (dollar === "RISING") {
    sectorOverlay.push({ sector: "commodities", bias: "BEAR",
      rationale: "stronger dollar → commodity headwind" });
    sectorOverlay.push({ sector: "tech_megacap", bias: "BULL",
      rationale: "USD strength historically supports US-listed megacap (relative)" });
  }
  if (credit === "WIDENING") {
    sectorOverlay.push({ sector: "high_yield_credit", bias: "BEAR",
      rationale: "HYG/LQD widening → risk-off, credit stress" });
    sectorOverlay.push({ sector: "small_caps", bias: "BEAR",
      rationale: "credit-sensitive — IWM under pressure when spreads widen" });
  } else if (credit === "TIGHTENING") {
    sectorOverlay.push({ sector: "high_yield_credit", bias: "BULL",
      rationale: "HYG/LQD tightening → risk-on, credit healthy" });
  }

  const sigDirection: "BULLISH" | "BEARISH" | "NEUTRAL" =
    bias === "BULL" ? "BULLISH" : bias === "BEAR" ? "BEARISH" : "NEUTRAL";
  const sigConfidence = bias === "NEUTRAL" ? 0.4 : tailRisk === "NONE" ? 0.7 : 0.5;

  const dxyDeviation = round(((args.dxy_spot - args.dxy_50dma) / args.dxy_50dma) * 100);
  const hygDeviation = round(((args.hyg_lqd_ratio - args.hyg_lqd_20dma) / args.hyg_lqd_20dma) * 100);

  return {
    macro_bias: bias,
    tail_risk: tailRisk,
    regime_size_modifier: regimeModifier,
    components: {
      dollar_trend: dollar,
      credit_spread_direction: credit,
      dxy_pct_vs_50dma: dxyDeviation,
      hyg_lqd_pct_vs_20dma: hygDeviation,
      vix_spot: args.vix_spot ?? null,
      vix_term_slope: args.vix_term_slope ?? null,
    },
    sector_overlay: sectorOverlay,
    signal_for_confluence: {
      group: "MACRO" as const,
      source: "macro_overlay",
      direction: sigDirection,
      confidence: sigConfidence,
      detail: `${bias} macro (DXY ${dollar}, credit ${credit}, tail=${tailRisk})`,
    },
    rationale:
      `DXY ${dollar} (${dxyDeviation > 0 ? "+" : ""}${dxyDeviation}% vs 50dma) + ` +
      `HYG/LQD ${credit} (${hygDeviation > 0 ? "+" : ""}${hygDeviation}% vs 20dma) → ` +
      `${bias} bias, tail-risk ${tailRisk}, size modifier ×${regimeModifier}`,
  };
}
