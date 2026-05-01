import type { UWDarkpoolTrade, UWFlowAlert } from "../clients/uw-client.js";

export type FlowDirection = "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL" | "UNKNOWN" | "NO_DATA";
export type OptionsBias =
  | "STRONGLY_BULLISH"
  | "BULLISH"
  | "NEUTRAL"
  | "BEARISH"
  | "STRONGLY_BEARISH"
  | "ALL_CALLS"
  | "NO_DATA";
export type CombinedSignal =
  | "STRONG_BULLISH_CONFLUENCE"
  | "STRONG_BEARISH_CONFLUENCE"
  | "DP_ACCUMULATION_ONLY"
  | "DP_DISTRIBUTION_ONLY"
  | `OPTIONS_${OptionsBias}_ONLY`
  | "NO_SIGNAL";

export interface DarkpoolAggregate {
  total_volume: number;
  total_premium: number;
  buy_volume: number;
  sell_volume: number;
  dp_buy_ratio: number | null;
  flow_direction: FlowDirection;
  flow_strength: number;
  num_prints: number;
}

export interface DailyDarkpoolSignal extends DarkpoolAggregate {
  date: string;
  is_partial?: boolean;
  trading_day_progress?: number;
}

export interface OptionsFlowSummary {
  total_alerts: number;
  total_premium: number;
  call_premium: number;
  put_premium: number;
  call_put_ratio: number | null;
  bias: OptionsBias;
}

export interface IntradayInterpolation {
  is_interpolated: boolean;
  actual: DarkpoolAggregate;
  interpolated: DarkpoolAggregate;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";
  trading_day_progress: number;
  trading_day_pct?: string;
  volume_pace?: number;
  volume_pace_note?: string;
  avg_prior_volume?: number;
  avg_prior_buy_ratio?: number | null;
  blending_weights?: { actual_weight: number; prior_weight: number };
  notes: string;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function dirFromRatio(ratio: number | null): { direction: FlowDirection; strength: number } {
  if (ratio === null) return { direction: "UNKNOWN", strength: 0 };
  if (ratio >= 0.55) return { direction: "ACCUMULATION", strength: round((ratio - 0.5) * 200, 1) };
  if (ratio <= 0.45) return { direction: "DISTRIBUTION", strength: round((0.5 - ratio) * 200, 1) };
  return { direction: "NEUTRAL", strength: 0 };
}

export function analyzeDarkpool(trades: readonly UWDarkpoolTrade[]): DarkpoolAggregate {
  if (trades.length === 0) {
    return {
      total_volume: 0,
      total_premium: 0,
      buy_volume: 0,
      sell_volume: 0,
      dp_buy_ratio: null,
      flow_direction: "NO_DATA",
      flow_strength: 0,
      num_prints: 0,
    };
  }

  let total_volume = 0;
  let total_premium = 0;
  let buy_volume = 0;
  let sell_volume = 0;
  let num_prints = 0;

  for (const t of trades) {
    if (t.canceled) continue;
    num_prints++;
    const size = Number(t.size) || 0;
    const price = Number(t.price) || 0;
    const premium = Number(t.premium) || 0;
    const bid = Number(t.nbbo_bid) || 0;
    const ask = Number(t.nbbo_ask) || 0;
    total_volume += size;
    total_premium += premium;
    if (bid > 0 && ask > 0) {
      const mid = (bid + ask) / 2;
      if (price >= mid) buy_volume += size;
      else sell_volume += size;
    }
  }

  const classified = buy_volume + sell_volume;
  const dp_buy_ratio = classified > 0 ? round(buy_volume / classified, 4) : null;
  const { direction, strength } = dirFromRatio(dp_buy_ratio);

  return {
    total_volume,
    total_premium: round(total_premium, 2),
    buy_volume,
    sell_volume,
    dp_buy_ratio,
    flow_direction: direction,
    flow_strength: strength,
    num_prints,
  };
}

export function analyzeOptionsFlow(alerts: readonly UWFlowAlert[]): OptionsFlowSummary {
  if (alerts.length === 0) {
    return {
      total_alerts: 0,
      total_premium: 0,
      call_premium: 0,
      put_premium: 0,
      call_put_ratio: null,
      bias: "NO_DATA",
    };
  }

  let call_premium = 0;
  let put_premium = 0;
  for (const a of alerts) {
    const prem = Number(a.premium) || 0;
    if (a.is_call) call_premium += prem;
    else put_premium += prem;
  }

  const total = call_premium + put_premium;
  const cp_ratio = put_premium > 0 ? round(call_premium / put_premium, 2) : null;

  let bias: OptionsBias;
  if (cp_ratio === null) {
    bias = call_premium > 0 ? "ALL_CALLS" : "NO_DATA";
  } else if (cp_ratio >= 2.0) bias = "STRONGLY_BULLISH";
  else if (cp_ratio >= 1.2) bias = "BULLISH";
  else if (cp_ratio <= 0.5) bias = "STRONGLY_BEARISH";
  else if (cp_ratio <= 0.8) bias = "BEARISH";
  else bias = "NEUTRAL";

  return {
    total_alerts: alerts.length,
    total_premium: round(total, 2),
    call_premium: round(call_premium, 2),
    put_premium: round(put_premium, 2),
    call_put_ratio: cp_ratio,
    bias,
  };
}

export function interpolateIntradayFlow(
  today: DarkpoolAggregate,
  priorDays: readonly DarkpoolAggregate[],
  progress: number,
): IntradayInterpolation {
  if (progress >= 1.0) {
    return {
      is_interpolated: false,
      actual: today,
      interpolated: today,
      confidence: "HIGH",
      trading_day_progress: 1.0,
      notes: "Full trading day data",
    };
  }
  if (progress <= 0 || priorDays.length === 0) {
    return {
      is_interpolated: false,
      actual: today,
      interpolated: today,
      confidence: "LOW",
      trading_day_progress: progress,
      notes: "Insufficient data for interpolation",
    };
  }

  const priorVols = priorDays.map((d) => d.total_volume).filter((v) => v > 0);
  const avgPriorVolume = priorVols.length > 0 ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : 0;

  const todayVolume = today.total_volume;
  const projVolume = todayVolume / progress;
  const projBuy = today.buy_volume / progress;
  const projSell = today.sell_volume / progress;

  const projClassified = projBuy + projSell;
  const interpRatio = projClassified > 0 ? projBuy / projClassified : null;

  const actualWeight = progress;
  const priorWeight = 1 - progress;

  const priorRatios = priorDays.map((d) => d.dp_buy_ratio).filter((r): r is number => r !== null);
  const avgPriorRatio = priorRatios.length > 0
    ? priorRatios.reduce((a, b) => a + b, 0) / priorRatios.length
    : 0.5;

  const blended = interpRatio !== null
    ? interpRatio * actualWeight + avgPriorRatio * priorWeight
    : avgPriorRatio;

  const { direction, strength } = dirFromRatio(blended);

  let confidence: "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";
  if (progress >= 0.75) confidence = "HIGH";
  else if (progress >= 0.5) confidence = "MEDIUM";
  else if (progress >= 0.25) confidence = "LOW";
  else confidence = "VERY_LOW";

  const expectedAtPoint = avgPriorVolume * progress;
  const volumePace = expectedAtPoint > 0 ? todayVolume / expectedAtPoint : 1.0;
  const paceNote = volumePace > 1.1 ? "Above" : volumePace < 0.9 ? "Below" : "At";

  const interpolated: DarkpoolAggregate = {
    total_volume: Math.round(projVolume),
    total_premium: progress > 0 ? round(today.total_premium / progress, 2) : 0,
    buy_volume: Math.round(projBuy),
    sell_volume: Math.round(projSell),
    dp_buy_ratio: round(blended, 4),
    flow_direction: direction,
    flow_strength: strength,
    num_prints: today.num_prints,
  };

  return {
    is_interpolated: true,
    actual: today,
    interpolated,
    confidence,
    trading_day_progress: round(progress, 3),
    trading_day_pct: `${(progress * 100).toFixed(1)}%`,
    volume_pace: round(volumePace, 2),
    volume_pace_note: `${paceNote} average pace`,
    avg_prior_volume: Math.round(avgPriorVolume),
    avg_prior_buy_ratio: priorRatios.length > 0 ? round(avgPriorRatio, 4) : null,
    blending_weights: { actual_weight: round(actualWeight, 2), prior_weight: round(priorWeight, 2) },
    notes: `Interpolated from ${(progress * 100).toFixed(0)}% of trading day. Confidence: ${confidence}.`,
  };
}

export function combineSignal(dpDir: FlowDirection, optBias: OptionsBias): CombinedSignal {
  if (dpDir === "ACCUMULATION" && (optBias === "BULLISH" || optBias === "STRONGLY_BULLISH")) {
    return "STRONG_BULLISH_CONFLUENCE";
  }
  if (dpDir === "DISTRIBUTION" && (optBias === "BEARISH" || optBias === "STRONGLY_BEARISH")) {
    return "STRONG_BEARISH_CONFLUENCE";
  }
  if (dpDir === "ACCUMULATION") return "DP_ACCUMULATION_ONLY";
  if (dpDir === "DISTRIBUTION") return "DP_DISTRIBUTION_ONLY";
  if (optBias !== "NEUTRAL" && optBias !== "NO_DATA") {
    return `OPTIONS_${optBias}_ONLY` as CombinedSignal;
  }
  return "NO_SIGNAL";
}

export type SignalQuality = "STRONG" | "MODERATE" | "WEAK" | "NONE" | "ERROR";

export interface SignalAnalysis {
  score: number;
  signal: SignalQuality;
  direction: FlowDirection;
  strength: number;
  buy_ratio: number | null;
  options_conflict: boolean;
  num_prints: number;
  sustained_days: number;
  recent_direction: FlowDirection;
  recent_strength: number;
  error?: string;
}

export interface FlowDataLike {
  error?: string;
  dark_pool?: {
    aggregate?: Partial<DarkpoolAggregate>;
    daily?: ReadonlyArray<Partial<DailyDarkpoolSignal>>;
  };
  options_flow?: { bias?: OptionsBias; combined_bias?: string };
}

export function analyzeSignal(flow: FlowDataLike): SignalAnalysis {
  if (flow.error) {
    return {
      score: -1,
      signal: "ERROR",
      direction: "UNKNOWN",
      strength: 0,
      buy_ratio: null,
      options_conflict: false,
      num_prints: 0,
      sustained_days: 0,
      recent_direction: "UNKNOWN",
      recent_strength: 0,
      error: flow.error,
    };
  }
  const dp = flow.dark_pool ?? {};
  const agg = dp.aggregate ?? {};
  const daily = dp.daily ?? [];

  const direction = (agg.flow_direction ?? "UNKNOWN") as FlowDirection;
  const strength = agg.flow_strength ?? 0;
  const buy_ratio = agg.dp_buy_ratio ?? null;
  const num_prints = agg.num_prints ?? 0;

  let sustained = 0;
  if (daily.length > 0) {
    const cur = daily[0]!.flow_direction;
    for (let i = 1; i < daily.length; i++) {
      const d = daily[i]!.flow_direction;
      if (d === cur && (cur === "ACCUMULATION" || cur === "DISTRIBUTION")) sustained++;
      else break;
    }
  }
  const recent_direction = (daily[0]?.flow_direction ?? "UNKNOWN") as FlowDirection;
  const recent_strength = daily[0]?.flow_strength ?? 0;

  let score = strength;
  if (sustained >= 2) score += 20;
  if (sustained >= 4) score += 20;
  if (recent_direction === direction && recent_strength > 50) score += 15;
  if (recent_direction !== direction && (recent_direction === "ACCUMULATION" || recent_direction === "DISTRIBUTION")) {
    score -= 30;
  }
  if (num_prints < 50) score -= 20;
  else if (num_prints < 100) score -= 10;

  let options_conflict = false;
  const optBias = flow.options_flow?.combined_bias ?? flow.options_flow?.bias;
  if (optBias) {
    const map: Record<string, FlowDirection> = {
      BULLISH: "ACCUMULATION",
      LEAN_BULLISH: "ACCUMULATION",
      STRONGLY_BULLISH: "ACCUMULATION",
      BEARISH: "DISTRIBUTION",
      LEAN_BEARISH: "DISTRIBUTION",
      STRONGLY_BEARISH: "DISTRIBUTION",
    };
    const expected = map[optBias];
    if (expected && expected !== direction && (direction === "ACCUMULATION" || direction === "DISTRIBUTION")) {
      options_conflict = true;
      score -= 25;
    }
  }

  let signal: SignalQuality;
  const isDirectional = direction === "ACCUMULATION" || direction === "DISTRIBUTION";
  if (score >= 60 && isDirectional) signal = "STRONG";
  else if (score >= 40 && isDirectional) signal = "MODERATE";
  else if (isDirectional) signal = "WEAK";
  else signal = "NONE";

  return {
    score: Math.round(score * 10) / 10,
    signal,
    direction,
    strength,
    buy_ratio,
    options_conflict,
    num_prints,
    sustained_days: sustained > 0 ? sustained + 1 : 0,
    recent_direction,
    recent_strength,
  };
}

export function aggregateDailySignals(daily: readonly DailyDarkpoolSignal[]): DarkpoolAggregate {
  if (daily.length === 0) {
    return {
      total_volume: 0,
      total_premium: 0,
      buy_volume: 0,
      sell_volume: 0,
      dp_buy_ratio: null,
      flow_direction: "NO_DATA",
      flow_strength: 0,
      num_prints: 0,
    };
  }
  let total_volume = 0;
  let total_premium = 0;
  let buy_volume = 0;
  let sell_volume = 0;
  let num_prints = 0;
  for (const d of daily) {
    total_volume += d.total_volume;
    total_premium += d.total_premium;
    buy_volume += d.buy_volume;
    sell_volume += d.sell_volume;
    num_prints += d.num_prints;
  }
  const classified = buy_volume + sell_volume;
  const dp_buy_ratio = classified > 0 ? round(buy_volume / classified, 4) : null;
  const { direction, strength } = dirFromRatio(dp_buy_ratio);
  return {
    total_volume,
    total_premium: round(total_premium, 2),
    buy_volume,
    sell_volume,
    dp_buy_ratio,
    flow_direction: direction,
    flow_strength: strength,
    num_prints,
  };
}
