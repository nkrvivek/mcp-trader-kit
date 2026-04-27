import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";
import { round } from "../utils/math.js";

export const RviGapArgs = z.object({
  ticker: TickerSchema,
  iv_30d: z.number().positive(),
  hv_30d: z.number().positive(),
  iv_history_mean: z.number().positive().optional(),
  iv_history_stdev: z.number().positive().optional(),
  rich_threshold_z: z.number().default(1.2),
  cheap_threshold_z: z.number().default(-1.2),
});

type Action = "SELL_PREMIUM" | "BUY_PREMIUM" | "NEUTRAL";

interface RviGapResult {
  ticker: string;
  iv_30d: number;
  hv_30d: number;
  rvi_gap: number;
  rvi_ratio: number;
  z_score: number | null;
  action: Action;
  signal_for_confluence: {
    group: "VOLATILITY";
    source: "rvi_gap";
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    confidence: number;
    detail: string;
  };
  rationale: string;
}

export async function rviGapHandler(raw: unknown): Promise<RviGapResult> {
  const args = RviGapArgs.parse(raw);
  const gap = args.iv_30d - args.hv_30d;
  const ratio = args.iv_30d / args.hv_30d;

  const z =
    args.iv_history_mean !== undefined && args.iv_history_stdev !== undefined && args.iv_history_stdev > 0
      ? (args.iv_30d - args.iv_history_mean) / args.iv_history_stdev
      : null;

  let action: Action = "NEUTRAL";
  if (z !== null) {
    if (z >= args.rich_threshold_z) action = "SELL_PREMIUM";
    else if (z <= args.cheap_threshold_z) action = "BUY_PREMIUM";
  } else {
    if (ratio >= 1.5) action = "SELL_PREMIUM";
    else if (ratio <= 0.8) action = "BUY_PREMIUM";
  }

  const confidence =
    z !== null
      ? Math.min(1.0, Math.abs(z) / 3.0)
      : Math.min(1.0, Math.abs(ratio - 1.0));

  const direction: "BULLISH" | "BEARISH" | "NEUTRAL" =
    action === "SELL_PREMIUM" ? "BEARISH" : action === "BUY_PREMIUM" ? "BULLISH" : "NEUTRAL";

  const rationale =
    z !== null
      ? `IV ${(args.iv_30d * 100).toFixed(1)}% vs history mean ${(args.iv_history_mean! * 100).toFixed(1)}% (z=${round(z)}) — ${action.toLowerCase().replace("_", " ")}`
      : `IV/HV ratio ${round(ratio)} (no history baseline) — ${action.toLowerCase().replace("_", " ")}`;

  return {
    ticker: args.ticker,
    iv_30d: args.iv_30d,
    hv_30d: args.hv_30d,
    rvi_gap: round(gap),
    rvi_ratio: round(ratio),
    z_score: z !== null ? round(z) : null,
    action,
    signal_for_confluence: {
      group: "VOLATILITY",
      source: "rvi_gap",
      direction,
      confidence: round(confidence),
      detail: rationale,
    },
    rationale,
  };
}
