import { z } from "zod";
import { TickerSchema, IsoDateSchema } from "../utils/schemas.js";
import { daysBetween } from "../utils/date.js";
import { round } from "../utils/math.js";

const TierEnum = z.enum(["GREEN", "YELLOW", "ORANGE", "RED", "CRITICAL"]);
type Tier = z.infer<typeof TierEnum>;

const StructureEnum = z.enum([
  "short_call",
  "short_put",
  "covered_call",
  "cash_secured_put",
]);

const ThresholdRow = z.object({
  spot_max: z.number().optional(),
  spot_min: z.number().optional(),
  delta_max: z.number().optional(),
  delta_min: z.number().optional(),
});

const ThresholdsSchema = z.object({
  green: ThresholdRow,
  yellow: ThresholdRow,
  orange: ThresholdRow,
  red: ThresholdRow,
  critical: ThresholdRow,
});

export const MonitorPositionArgs = z.object({
  position_id: z.string().min(1),
  ticker: TickerSchema,
  structure: StructureEnum,
  strike: z.number().positive(),
  expiry: IsoDateSchema,
  contracts: z.number().int().positive(),
  fill_price: z.number().nonnegative(),
  fill_spot: z.number().positive().optional(),
  fill_delta: z.number().optional(),
  fill_iv: z.number().nonnegative().optional(),
  current_spot: z.number().positive(),
  current_delta: z.number(),
  current_iv: z.number().nonnegative().optional(),
  thresholds: ThresholdsSchema.optional(),
  as_of: z.string().optional(),
});

type Args = z.infer<typeof MonitorPositionArgs>;

interface TierResult {
  tier: Tier;
  by_spot: Tier;
  by_delta: Tier;
  rationale: string[];
}

interface MonitorReading {
  position_id: string;
  ticker: string;
  structure: string;
  strike: number;
  expiry: string;
  contracts: number;
  as_of: string;
  spot: number;
  delta: number;
  iv?: number | undefined;
  buffer_otm: number;
  dte: number;
  tier: Tier;
  tier_breakdown: TierResult;
  action: "hold" | "flag" | "alarm" | "urgent" | "stop_everything";
  message: string;
  deltas_vs_fill?: {
    spot?: number;
    delta?: number;
    iv?: number;
    buffer?: number;
  };
  next_review_dte: number | null;
  thresholds_used: z.infer<typeof ThresholdsSchema>;
  warnings: string[];
}

const SHORT_CALL_DEFAULTS: z.infer<typeof ThresholdsSchema> = {
  green: { spot_max: Infinity, delta_max: 0.32 },
  yellow: { delta_max: 0.42 },
  orange: { delta_max: 0.55 },
  red: { delta_max: 0.65 },
  critical: { delta_min: 0.65 },
};

const SHORT_PUT_DEFAULTS: z.infer<typeof ThresholdsSchema> = {
  green: { delta_max: 0.32 },
  yellow: { delta_max: 0.42 },
  orange: { delta_max: 0.55 },
  red: { delta_max: 0.65 },
  critical: { delta_min: 0.65 },
};

function defaultThresholds(structure: Args["structure"]): z.infer<typeof ThresholdsSchema> {
  if (structure === "short_put" || structure === "cash_secured_put") return SHORT_PUT_DEFAULTS;
  return SHORT_CALL_DEFAULTS;
}

function tierForSpot(spot: number, t: z.infer<typeof ThresholdsSchema>, structure: Args["structure"]): Tier {
  // For short calls / CCs: rising spot = worse. For short puts / CSPs: falling spot = worse.
  const isCall = structure === "short_call" || structure === "covered_call";
  if (isCall) {
    if (t.critical.spot_min !== undefined && spot >= t.critical.spot_min) return "CRITICAL";
    if (t.red.spot_min !== undefined && spot >= t.red.spot_min) return "RED";
    if (t.orange.spot_min !== undefined && spot >= t.orange.spot_min) return "ORANGE";
    if (t.yellow.spot_min !== undefined && spot >= t.yellow.spot_min) return "YELLOW";
    return "GREEN";
  } else {
    if (t.critical.spot_max !== undefined && spot <= t.critical.spot_max) return "CRITICAL";
    if (t.red.spot_max !== undefined && spot <= t.red.spot_max) return "RED";
    if (t.orange.spot_max !== undefined && spot <= t.orange.spot_max) return "ORANGE";
    if (t.yellow.spot_max !== undefined && spot <= t.yellow.spot_max) return "YELLOW";
    return "GREEN";
  }
}

function tierForDelta(deltaAbs: number, t: z.infer<typeof ThresholdsSchema>): Tier {
  if (t.critical.delta_min !== undefined && deltaAbs >= t.critical.delta_min) return "CRITICAL";
  if (t.red.delta_max !== undefined && deltaAbs >= t.red.delta_max) return "CRITICAL";
  if (t.orange.delta_max !== undefined && deltaAbs >= t.orange.delta_max) return "RED";
  if (t.yellow.delta_max !== undefined && deltaAbs >= t.yellow.delta_max) return "ORANGE";
  if (t.green.delta_max !== undefined && deltaAbs >= t.green.delta_max) return "YELLOW";
  return "GREEN";
}

const TIER_RANK: Record<Tier, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3, CRITICAL: 4 };

function worse(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

const ACTION_FOR_TIER: Record<Tier, MonitorReading["action"]> = {
  GREEN: "hold",
  YELLOW: "flag",
  ORANGE: "alarm",
  RED: "urgent",
  CRITICAL: "stop_everything",
};

function messageFor(tier: Tier, ticker: string, structure: string, strike: number, spot: number, deltaAbs: number): string {
  const sym = `${ticker} ${strike}${structure.includes("call") ? "C" : "P"}`;
  switch (tier) {
    case "GREEN":
      return `${sym} monitor: GREEN spot=$${spot.toFixed(2)} Δ=${deltaAbs.toFixed(4)}`;
    case "YELLOW":
      return `🟡 ${sym} YELLOW: spot $${spot.toFixed(2)} Δ ${deltaAbs.toFixed(4)}. Pre-staging roll math.`;
    case "ORANGE":
      return `🟠 ${sym} ORANGE ALARM. spot $${spot.toFixed(2)} Δ ${deltaAbs.toFixed(4)}. Run roll calc.`;
    case "RED":
      return `🔴 ${sym} RED — DEFENSIVE ACTION. spot $${spot.toFixed(2)} Δ ${deltaAbs.toFixed(4)}. Roll up+out for credit OR BTC.`;
    case "CRITICAL":
      return `🚨 ${sym} CRITICAL — CROWN JEWEL AT RISK. spot $${spot.toFixed(2)} Δ ${deltaAbs.toFixed(4)}. BTC NOW.`;
  }
}

function nextReviewDte(currentDte: number): number | null {
  for (const gate of [14, 7, 3, 1]) {
    if (currentDte > gate) return gate;
  }
  return null;
}

export async function monitorPositionHandler(raw: unknown): Promise<MonitorReading> {
  const args = MonitorPositionArgs.parse(raw);
  const thresholds = args.thresholds ?? defaultThresholds(args.structure);

  const asOf = args.as_of ?? new Date().toISOString();
  const todayIso = asOf.slice(0, 10);
  const dte = Math.max(0, daysBetween(todayIso, args.expiry));
  const deltaAbs = Math.abs(args.current_delta);

  const isCall = args.structure === "short_call" || args.structure === "covered_call";
  const bufferOtm = isCall ? args.strike - args.current_spot : args.current_spot - args.strike;

  const bySpot = tierForSpot(args.current_spot, thresholds, args.structure);
  const byDelta = tierForDelta(deltaAbs, thresholds);
  const tier = worse(bySpot, byDelta);

  const rationale: string[] = [];
  rationale.push(`spot tier ${bySpot} (spot=${args.current_spot.toFixed(2)} vs strike=${args.strike})`);
  rationale.push(`delta tier ${byDelta} (|Δ|=${deltaAbs.toFixed(4)})`);
  rationale.push(`worst-of → ${tier}`);

  const warnings: string[] = [];
  if (dte === 0) warnings.push("position expires today — final-day rules apply");
  if (dte <= 1 && tier !== "GREEN") warnings.push("≤1 DTE w/ non-GREEN tier — only acceptable state is far OTM (Δ<0.10)");
  if (isCall && args.current_spot >= args.strike) warnings.push(`short call ITM: spot ${args.current_spot} ≥ strike ${args.strike}`);
  if (!isCall && args.current_spot <= args.strike) warnings.push(`short put ITM: spot ${args.current_spot} ≤ strike ${args.strike}`);

  const deltasVsFill: MonitorReading["deltas_vs_fill"] = {};
  if (args.fill_spot !== undefined) deltasVsFill.spot = round(args.current_spot - args.fill_spot);
  if (args.fill_delta !== undefined) deltasVsFill.delta = round(deltaAbs - Math.abs(args.fill_delta), 10_000);
  if (args.fill_iv !== undefined && args.current_iv !== undefined) deltasVsFill.iv = round(args.current_iv - args.fill_iv, 10_000);
  if (args.fill_spot !== undefined) {
    const fillBuffer = isCall ? args.strike - args.fill_spot : args.fill_spot - args.strike;
    deltasVsFill.buffer = round(bufferOtm - fillBuffer);
  }

  const reading: MonitorReading = {
    position_id: args.position_id,
    ticker: args.ticker,
    structure: args.structure,
    strike: args.strike,
    expiry: args.expiry,
    contracts: args.contracts,
    as_of: asOf,
    spot: round(args.current_spot),
    delta: round(deltaAbs, 10_000),
    buffer_otm: round(bufferOtm),
    dte,
    tier,
    tier_breakdown: { tier, by_spot: bySpot, by_delta: byDelta, rationale },
    action: ACTION_FOR_TIER[tier],
    message: messageFor(tier, args.ticker, args.structure, args.strike, args.current_spot, deltaAbs),
    next_review_dte: nextReviewDte(dte),
    thresholds_used: thresholds,
    warnings,
  };
  if (args.current_iv !== undefined) reading.iv = args.current_iv;
  if (Object.keys(deltasVsFill).length > 0) reading.deltas_vs_fill = deltasVsFill;
  return reading;
}
