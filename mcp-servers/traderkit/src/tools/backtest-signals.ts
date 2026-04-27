import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";
import { round } from "../utils/math.js";

const Tier = z.enum(["CORE", "TIER-1", "TIER-2", "WATCH", "NOISE"]);

const HistoricalEntry = z.object({
  ticker: TickerSchema,
  entry_date: z.string(),
  tier_at_entry: Tier,
  confluence_score_at_entry: z.number().optional(),
  realized_pnl_usd: z.number(),
  realized_return_pct: z.number().optional(),
  outcome: z.enum([
    "WIN_MANAGED", "WIN_EXPIRED", "LOSS_STOPPED", "LOSS_ASSIGNED",
    "LOSS_ROLLED", "BREAKEVEN", "UNCATEGORIZED",
  ]).optional(),
  predicted_direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]).optional(),
  realized_direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]).optional(),
});

export const BacktestSignalsArgs = z.object({
  history: z.array(HistoricalEntry).min(1),
  win_threshold_usd: z.number().default(0),
});

type TierKey = z.infer<typeof Tier>;

interface TierStats {
  tier: TierKey;
  trade_count: number;
  win_count: number;
  loss_count: number;
  hit_rate: number;
  total_pnl_usd: number;
  avg_pnl_usd: number;
  avg_return_pct: number | null;
  direction_accuracy: number | null;
}

const TIER_ORDER: TierKey[] = ["CORE", "TIER-1", "TIER-2", "WATCH", "NOISE"];

export async function backtestSignalsHandler(raw: unknown) {
  const args = BacktestSignalsArgs.parse(raw);

  const byTier = new Map<TierKey, z.infer<typeof HistoricalEntry>[]>();
  for (const t of TIER_ORDER) byTier.set(t, []);
  for (const e of args.history) byTier.get(e.tier_at_entry)!.push(e);

  const tierStats: TierStats[] = TIER_ORDER.map((tier) => {
    const trades = byTier.get(tier)!;
    const count = trades.length;
    if (count === 0) {
      return {
        tier, trade_count: 0, win_count: 0, loss_count: 0, hit_rate: 0,
        total_pnl_usd: 0, avg_pnl_usd: 0, avg_return_pct: null,
        direction_accuracy: null,
      };
    }
    const wins = trades.filter((t) => t.realized_pnl_usd > args.win_threshold_usd).length;
    const losses = trades.filter((t) => t.realized_pnl_usd < -args.win_threshold_usd).length;
    const decisive = wins + losses;
    const totalPnl = trades.reduce((s, t) => s + t.realized_pnl_usd, 0);

    const returnsWith = trades.filter((t) => t.realized_return_pct !== undefined);
    const avgReturn = returnsWith.length
      ? returnsWith.reduce((s, t) => s + t.realized_return_pct!, 0) / returnsWith.length
      : null;

    const dirWith = trades.filter((t) => t.predicted_direction && t.realized_direction);
    const dirHits = dirWith.filter((t) => t.predicted_direction === t.realized_direction).length;
    const dirAccuracy = dirWith.length > 0 ? dirHits / dirWith.length : null;

    return {
      tier,
      trade_count: count,
      win_count: wins,
      loss_count: losses,
      hit_rate: decisive > 0 ? round(wins / decisive) : 0,
      total_pnl_usd: round(totalPnl),
      avg_pnl_usd: round(totalPnl / count),
      avg_return_pct: avgReturn !== null ? round(avgReturn) : null,
      direction_accuracy: dirAccuracy !== null ? round(dirAccuracy) : null,
    };
  });

  const monotonicWarnings: string[] = [];
  const ranked = tierStats.filter((t) => t.trade_count >= 3);
  for (let i = 1; i < ranked.length; i++) {
    const higher = ranked[i - 1]!;
    const lower = ranked[i]!;
    if (lower.hit_rate > higher.hit_rate + 0.05) {
      monotonicWarnings.push(
        `calibration warning: ${lower.tier} hit-rate (${lower.hit_rate}) > ${higher.tier} (${higher.hit_rate}) — tier scoring may be miscalibrated`,
      );
    }
  }

  const totalTrades = args.history.length;
  const totalWins = args.history.filter((e) => e.realized_pnl_usd > args.win_threshold_usd).length;
  const totalLosses = args.history.filter((e) => e.realized_pnl_usd < -args.win_threshold_usd).length;
  const decisiveTotal = totalWins + totalLosses;
  const totalPnl = args.history.reduce((s, e) => s + e.realized_pnl_usd, 0);

  const tierEligibleTrades = args.history.filter(
    (e) => e.tier_at_entry === "CORE" || e.tier_at_entry === "TIER-1",
  );
  const tierEligiblePnl = tierEligibleTrades.reduce((s, e) => s + e.realized_pnl_usd, 0);
  const watchNoiseTrades = args.history.filter(
    (e) => e.tier_at_entry === "WATCH" || e.tier_at_entry === "NOISE",
  );
  const watchNoisePnl = watchNoiseTrades.reduce((s, e) => s + e.realized_pnl_usd, 0);

  return {
    tier_stats: tierStats,
    overall: {
      total_trades: totalTrades,
      win_count: totalWins,
      loss_count: totalLosses,
      hit_rate: decisiveTotal > 0 ? round(totalWins / decisiveTotal) : 0,
      total_pnl_usd: round(totalPnl),
      avg_pnl_usd: round(totalPnl / totalTrades),
    },
    tier_gate_impact: {
      tier_eligible_count: tierEligibleTrades.length,
      tier_eligible_pnl_usd: round(tierEligiblePnl),
      watch_noise_count: watchNoiseTrades.length,
      watch_noise_pnl_usd: round(watchNoisePnl),
      gate_pnl_savings_usd: round(-watchNoisePnl),
    },
    calibration_warnings: monotonicWarnings,
    interpretation: monotonicWarnings.length === 0
      ? "Tier scoring monotonic — higher tiers showed higher hit rates (signal-rank framework calibrated)."
      : `Calibration issues detected (${monotonicWarnings.length}). Review tier-scoring formula or backtest sample size.`,
  };
}
