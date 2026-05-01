import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";
import {
  uwDarkpoolFlow,
  uwFlowAlerts,
  type UWFlowAlert,
  type UWDarkpoolTrade,
} from "../clients/uw-client.js";
import { isTradingDay, getLastNTradingDays, toIsoDate } from "../utils/calendar.js";
import { analyzeDarkpool, type FlowDirection } from "../utils/flow.js";

export const SCORING_WEIGHTS = {
  dp_strength: 30,
  dp_sustained: 20,
  confluence: 20,
  vol_oi: 15,
  sweeps: 15,
} as const;

const INDEX_SYMBOLS = new Set(["SPX", "SPXW", "NDX", "RUT", "VIX", "DJX", "OEX", "XSP"]);

export const DiscoverFlowArgs = z.object({
  mode: z.enum(["market", "targeted"]).default("market"),
  tickers: z.array(TickerSchema).optional(),
  excluded_tickers: z.array(TickerSchema).default([]),
  min_premium: z.number().int().nonnegative().optional(),
  min_alerts: z.number().int().positive().default(1),
  dp_days: z.number().int().positive().max(10).default(3),
  top: z.number().int().positive().max(100).default(20),
  exclude_indices: z.boolean().default(true),
  market_alert_limit: z.number().int().positive().max(500).default(200),
  targeted_alert_limit: z.number().int().positive().max(200).default(50),
});

export interface DiscoverCandidate {
  ticker: string;
  score: number;
  score_breakdown: {
    dp_strength: number;
    dp_sustained: number;
    confluence: number;
    vol_oi: number;
    sweeps: number;
  };
  alerts: number;
  total_premium: number;
  calls: number;
  puts: number;
  options_bias: "BULLISH" | "BEARISH" | "MIXED";
  sweeps: number;
  avg_vol_oi: number;
  sector: string;
  issue_type: string;
  dp_direction: FlowDirection;
  dp_strength: number;
  dp_buy_ratio: number | null;
  dp_sustained_days: number;
  dp_total_prints: number;
  confluence: boolean;
}

export interface DiscoverFlowResult {
  discovery_time: string;
  mode: "market" | "targeted";
  scoring_weights: typeof SCORING_WEIGHTS;
  tickers_scanned?: number;
  alerts_analyzed?: number;
  candidates_found: number;
  candidates: DiscoverCandidate[];
}

interface FlowAggregate {
  alerts: number;
  total_premium: number;
  calls: number;
  puts: number;
  sweeps: number;
  vol_oi_ratios: number[];
  sector: string;
  marketcap: number;
  underlying_price: number;
  issue_type: string;
}

function emptyAggregate(): FlowAggregate {
  return {
    alerts: 0, total_premium: 0, calls: 0, puts: 0,
    sweeps: 0, vol_oi_ratios: [], sector: "", marketcap: 0,
    underlying_price: 0, issue_type: "",
  };
}

function aggregateAlerts(alerts: readonly UWFlowAlert[]): Map<string, FlowAggregate> {
  const map = new Map<string, FlowAggregate>();
  for (const a of alerts) {
    const t = a.ticker;
    if (!t) continue;
    let agg = map.get(t);
    if (!agg) { agg = emptyAggregate(); map.set(t, agg); }
    agg.alerts += 1;
    agg.total_premium += a.total_premium || 0;
    if (a.type === "CALL") agg.calls += 1;
    else if (a.type === "PUT") agg.puts += 1;
    if (a.has_sweep) agg.sweeps += 1;
    if (a.volume_oi_ratio > 0) agg.vol_oi_ratios.push(a.volume_oi_ratio);
    agg.sector = a.sector ?? agg.sector;
    agg.marketcap = a.marketcap ?? agg.marketcap;
    agg.underlying_price = a.underlying_price ?? agg.underlying_price;
    agg.issue_type = a.issue_type ?? agg.issue_type;
  }
  return map;
}

interface MultiDayDp {
  aggregate: ReturnType<typeof analyzeDarkpool>;
  daily: { date: string; direction: FlowDirection; strength: number; buy_ratio: number | null; prints: number }[];
  sustained_days: number;
  total_prints: number;
}

async function fetchDarkpoolMulti(
  ticker: string,
  days: number,
  now: Date,
  fetchDp: (ticker: string, date: string) => Promise<UWDarkpoolTrade[]>,
): Promise<MultiDayDp> {
  const tradingDays = getLastNTradingDays(days, now);
  const todayStr = toIsoDate(now);
  if (isTradingDay(now) && !tradingDays.includes(todayStr)) {
    tradingDays.unshift(todayStr);
  }

  const results = await Promise.all(
    tradingDays.map(async (date) => {
      const trades = await fetchDp(ticker, date);
      const sig = analyzeDarkpool(trades);
      return { date, sig, trades };
    }),
  );

  const all: UWDarkpoolTrade[] = [];
  const daily: MultiDayDp["daily"] = [];
  for (const { date, sig, trades } of results) {
    daily.push({
      date,
      direction: sig.flow_direction,
      strength: sig.flow_strength,
      buy_ratio: sig.dp_buy_ratio,
      prints: sig.num_prints,
    });
    all.push(...trades);
  }

  const aggregate = analyzeDarkpool(all);

  let sustained = 0;
  if (daily.length > 0) {
    const first = daily[0]!.direction;
    if (first === "ACCUMULATION" || first === "DISTRIBUTION") {
      sustained = 1;
      for (let i = 1; i < daily.length; i++) {
        if (daily[i]!.direction === first) sustained++;
        else break;
      }
    }
  }

  return {
    aggregate,
    daily,
    sustained_days: sustained,
    total_prints: daily.reduce((s, d) => s + d.prints, 0),
  };
}

function calculateScore(
  dpStrength: number,
  dpSustained: number,
  hasConfluence: boolean,
  volOi: number,
  sweepCount: number,
): { total: number; weighted: DiscoverCandidate["score_breakdown"] } {
  const dpStrengthScore = Math.min(dpStrength, 100);
  const dpSustainedScore = Math.min(dpSustained * 20, 100);
  const confluenceScore = hasConfluence ? 100 : 0;

  let volOiScore: number;
  if (volOi <= 1.0) volOiScore = 0;
  else if (volOi <= 2.0) volOiScore = (volOi - 1.0) * 50;
  else if (volOi <= 4.0) volOiScore = 50 + (volOi - 2.0) * 25;
  else volOiScore = 100;

  const sweepScore = sweepCount === 0 ? 0 : sweepCount === 1 ? 50 : 100;

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const w = SCORING_WEIGHTS;
  const weighted = {
    dp_strength: round1((dpStrengthScore * w.dp_strength) / 100),
    dp_sustained: round1((dpSustainedScore * w.dp_sustained) / 100),
    confluence: round1((confluenceScore * w.confluence) / 100),
    vol_oi: round1((volOiScore * w.vol_oi) / 100),
    sweeps: round1((sweepScore * w.sweeps) / 100),
  };
  const total = round1(
    weighted.dp_strength + weighted.dp_sustained + weighted.confluence + weighted.vol_oi + weighted.sweeps,
  );
  return { total, weighted };
}

function buildCandidate(ticker: string, flow: FlowAggregate, dp: MultiDayDp): DiscoverCandidate {
  const calls = flow.calls;
  const puts = flow.puts;
  const optionsBias: "BULLISH" | "BEARISH" | "MIXED" =
    calls > puts * 1.5 ? "BULLISH" : puts > calls * 1.5 ? "BEARISH" : "MIXED";

  const hasConfluence =
    (optionsBias === "BULLISH" && dp.aggregate.flow_direction === "ACCUMULATION") ||
    (optionsBias === "BEARISH" && dp.aggregate.flow_direction === "DISTRIBUTION");

  const avgVolOi = flow.vol_oi_ratios.length > 0
    ? flow.vol_oi_ratios.reduce((a, b) => a + b, 0) / flow.vol_oi_ratios.length
    : 0;

  const score = calculateScore(
    dp.aggregate.flow_strength,
    dp.sustained_days,
    hasConfluence,
    avgVolOi,
    flow.sweeps,
  );

  return {
    ticker,
    score: score.total,
    score_breakdown: score.weighted,
    alerts: flow.alerts,
    total_premium: Math.round(flow.total_premium * 100) / 100,
    calls,
    puts,
    options_bias: optionsBias,
    sweeps: flow.sweeps,
    avg_vol_oi: Math.round(avgVolOi * 100) / 100,
    sector: flow.sector,
    issue_type: flow.issue_type,
    dp_direction: dp.aggregate.flow_direction,
    dp_strength: dp.aggregate.flow_strength,
    dp_buy_ratio: dp.aggregate.dp_buy_ratio,
    dp_sustained_days: dp.sustained_days,
    dp_total_prints: dp.total_prints,
    confluence: hasConfluence,
  };
}

interface DiscoverFlowDeps {
  fetchMarketAlerts?: (minPremium: number, limit: number) => Promise<UWFlowAlert[]>;
  fetchTickerAlerts?: (ticker: string, minPremium: number, limit: number) => Promise<UWFlowAlert[]>;
  fetchDarkpool?: (ticker: string, date: string) => Promise<UWDarkpoolTrade[]>;
  now?: () => Date;
}

export async function discoverFlowHandler(
  raw: unknown,
  deps: DiscoverFlowDeps = {},
): Promise<DiscoverFlowResult> {
  const args = DiscoverFlowArgs.parse(raw);
  if (args.mode === "targeted" && (!args.tickers || args.tickers.length === 0)) {
    throw new Error("tickers required when mode=targeted");
  }
  const now = deps.now ? deps.now() : new Date();
  const fetchMarketAlerts = deps.fetchMarketAlerts
    ?? ((mp, lim) => uwFlowAlerts({ minPremium: mp, limit: lim }));
  const fetchTickerAlerts = deps.fetchTickerAlerts
    ?? ((t, mp, lim) => uwFlowAlerts({ ticker: t, minPremium: mp, limit: lim }));
  const fetchDp = deps.fetchDarkpool ?? ((t, d) => uwDarkpoolFlow(t, { date: d }));

  const excluded = new Set(args.excluded_tickers);

  if (args.mode === "targeted") {
    const tickers = args.tickers!;
    const minPrem = args.min_premium ?? 50000;
    const candidates: DiscoverCandidate[] = [];

    const results = await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const alerts = await fetchTickerAlerts(ticker, minPrem, args.targeted_alert_limit);
          const flowMap = aggregateAlerts(alerts);
          const flow = flowMap.get(ticker) ?? emptyAggregate();
          const dp = await fetchDarkpoolMulti(ticker, args.dp_days, now, fetchDp);
          return buildCandidate(ticker, flow, dp);
        } catch (e) {
          process.stderr.write(`discover_flow: ${ticker} failed: ${e instanceof Error ? e.message : e}\n`);
          return null;
        }
      }),
    );
    for (const c of results) if (c) candidates.push(c);

    candidates.sort((a, b) => b.score - a.score);

    return {
      discovery_time: now.toISOString(),
      mode: "targeted",
      scoring_weights: SCORING_WEIGHTS,
      tickers_scanned: tickers.length,
      candidates_found: candidates.length,
      candidates: candidates.slice(0, args.top),
    };
  }

  const minPrem = args.min_premium ?? 500000;
  const alerts = await fetchMarketAlerts(minPrem, args.market_alert_limit);

  if (alerts.length === 0) {
    return {
      discovery_time: now.toISOString(),
      mode: "market",
      scoring_weights: SCORING_WEIGHTS,
      alerts_analyzed: 0,
      candidates_found: 0,
      candidates: [],
    };
  }

  const flowMap = aggregateAlerts(alerts);
  const tickersToCheck = [...flowMap.keys()].filter((t) => {
    if (excluded.has(t)) return false;
    if (flowMap.get(t)!.alerts < args.min_alerts) return false;
    if (args.exclude_indices && INDEX_SYMBOLS.has(t)) return false;
    return true;
  });

  const candidates: DiscoverCandidate[] = [];
  const results = await Promise.all(
    tickersToCheck.map(async (ticker) => {
      try {
        const dp = await fetchDarkpoolMulti(ticker, args.dp_days, now, fetchDp);
        return buildCandidate(ticker, flowMap.get(ticker)!, dp);
      } catch (e) {
        process.stderr.write(`discover_flow: ${ticker} failed: ${e instanceof Error ? e.message : e}\n`);
        return null;
      }
    }),
  );
  for (const c of results) if (c) candidates.push(c);

  candidates.sort((a, b) => b.score - a.score);

  return {
    discovery_time: now.toISOString(),
    mode: "market",
    scoring_weights: SCORING_WEIGHTS,
    alerts_analyzed: alerts.length,
    candidates_found: candidates.length,
    candidates: candidates.slice(0, args.top),
  };
}
