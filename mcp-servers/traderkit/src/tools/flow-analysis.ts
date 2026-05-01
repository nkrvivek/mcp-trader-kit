import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";
import { fetchFlowHandler, type FetchFlowResult } from "./fetch-flow.js";
import { analyzeSignal, type SignalAnalysis } from "../utils/flow.js";

const PositionSchema = z.object({
  ticker: TickerSchema,
  direction: z
    .enum(["LONG", "SHORT", "BUY", "SELL", "DEBIT", "CREDIT", "long", "short", "buy", "sell", "debit", "credit"])
    .transform((v) => v.toUpperCase() as "LONG" | "SHORT" | "BUY" | "SELL" | "DEBIT" | "CREDIT")
    .default("LONG"),
  structure: z.string().default("Unknown"),
  position_id: z.string().optional(),
});

export const FlowAnalysisArgs = z.object({
  positions: z.array(PositionSchema).min(0),
  lookback_days: z.number().int().positive().max(30).default(5),
});

export type FlowAnalysisInput = z.input<typeof FlowAnalysisArgs>;

export type FlowCategory = "supports" | "against" | "watch" | "neutral";

export interface ClassifiedPosition {
  ticker: string;
  position: string;
  direction: string;
  position_id?: string | undefined;
  flow_direction: string;
  flow_label: string;
  flow_class: "accum" | "distrib" | "neutral";
  signal: SignalAnalysis["signal"];
  score: number;
  strength: number;
  buy_ratio: number | null;
  daily_buy_ratios: { date: string; buy_ratio: number | null }[];
  note: string;
  category: FlowCategory;
}

export interface FlowAnalysisResult {
  analysis_time: string;
  positions_scanned: number;
  supports: ClassifiedPosition[];
  against: ClassifiedPosition[];
  watch: ClassifiedPosition[];
  neutral: ClassifiedPosition[];
  errors: { ticker: string; error: string }[];
}

interface FlowAnalysisDeps {
  fetchFlow?: (ticker: string, lookback_days: number) => Promise<FetchFlowResult>;
  now?: () => Date;
}

function classify(
  pos: { ticker: string; direction: string; structure: string; position_id?: string | undefined },
  flow: FetchFlowResult,
  analysis: SignalAnalysis,
): ClassifiedPosition {
  const { signal, direction: flowDir, strength, buy_ratio, sustained_days, recent_direction } = analysis;

  let flow_label: string;
  let flow_class: "accum" | "distrib" | "neutral";
  if (buy_ratio !== null) {
    const pct = Math.round(buy_ratio * 100);
    if (flowDir === "ACCUMULATION") {
      flow_label = `${pct}% ACCUM`;
      flow_class = "accum";
    } else if (flowDir === "DISTRIBUTION") {
      flow_label = `${100 - pct}% DISTRIB`;
      flow_class = "distrib";
    } else {
      flow_label = `${pct}% NEUTRAL`;
      flow_class = "neutral";
    }
  } else {
    flow_label = "NO DATA";
    flow_class = "neutral";
  }

  let note: string;
  if (signal === "STRONG") {
    note = sustained_days >= 3
      ? `Strong signal, ${sustained_days}-day sustained ${flowDir.toLowerCase()}`
      : `Strong institutional ${flowDir.toLowerCase()}`;
  } else if (signal === "MODERATE") {
    note = recent_direction !== flowDir && (recent_direction === "ACCUMULATION" || recent_direction === "DISTRIBUTION")
      ? `Mixed: aggregate ${flowDir.toLowerCase()}, recent ${recent_direction.toLowerCase()}`
      : `Moderate ${flowDir.toLowerCase()} signal`;
  } else if (signal === "WEAK") {
    note = `Weak ${flowDir.toLowerCase()} signal`;
  } else {
    note = "No actionable signal";
  }

  const isLong = pos.direction === "LONG" || pos.direction === "BUY" || pos.direction === "DEBIT";
  const isShort = pos.direction === "SHORT" || pos.direction === "SELL" || pos.direction === "CREDIT";

  let category: FlowCategory = "neutral";
  const recentConflict =
    recent_direction !== flowDir
    && (recent_direction === "ACCUMULATION" || recent_direction === "DISTRIBUTION")
    && (flowDir === "ACCUMULATION" || flowDir === "DISTRIBUTION");
  if (signal === "STRONG" || signal === "MODERATE") {
    const supportsLong = flowDir === "ACCUMULATION";
    const supportsShort = flowDir === "DISTRIBUTION";
    if (signal === "MODERATE" && recentConflict) {
      category = "watch";
    } else if ((isLong && supportsLong) || (isShort && supportsShort)) category = "supports";
    else if ((isLong && supportsShort) || (isShort && supportsLong)) category = "against";
    else category = "neutral";
  } else if (signal === "WEAK" && recentConflict) {
    category = "watch";
  }

  const daily = flow.dark_pool.daily;
  const sortedDaily = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const daily_buy_ratios = sortedDaily.map((d) => ({ date: d.date, buy_ratio: d.dp_buy_ratio }));

  return {
    ticker: pos.ticker,
    position: pos.structure,
    direction: pos.direction,
    position_id: pos.position_id,
    flow_direction: flowDir,
    flow_label,
    flow_class,
    signal,
    score: analysis.score,
    strength: Math.round(strength * 10) / 10,
    buy_ratio,
    daily_buy_ratios,
    note,
    category,
  };
}

export async function flowAnalysisHandler(
  raw: unknown,
  deps: FlowAnalysisDeps = {},
): Promise<FlowAnalysisResult> {
  const args = FlowAnalysisArgs.parse(raw);
  const now = deps.now ? deps.now() : new Date();
  const fetchFlow = deps.fetchFlow
    ?? ((t, lb) => fetchFlowHandler({ ticker: t, lookback_days: lb, skip_options_flow: true }));

  const result: FlowAnalysisResult = {
    analysis_time: now.toISOString(),
    positions_scanned: args.positions.length,
    supports: [],
    against: [],
    watch: [],
    neutral: [],
    errors: [],
  };

  if (args.positions.length === 0) return result;

  for (const pos of args.positions) {
    try {
      const flow = await fetchFlow(pos.ticker, args.lookback_days);
      const analysis = analyzeSignal(flow);
      const classified = classify(pos, flow, analysis);
      result[classified.category].push(classified);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({ ticker: pos.ticker, error: msg });
    }
  }

  for (const cat of ["supports", "against", "watch", "neutral"] as const) {
    result[cat].sort((a, b) => b.strength - a.strength);
  }

  return result;
}
