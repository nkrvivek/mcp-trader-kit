import { z } from "zod";
import { uwOptionChain, uwExpiryList, uwIvRank, uwStockState } from "../clients/uw-client.js";
import { finnhubProfile, finnhubEarnings } from "../clients/finnhub-client.js";

export const ScreenOptionsArgs = z.object({
  tickers: z.array(z.string().min(1).max(10)).min(1).max(50),
  strategy: z.enum(["csp", "cc", "pcs", "ccs"]).default("csp"),
  dte_min: z.number().int().positive().default(14),
  dte_max: z.number().int().positive().default(45),
  delta_abs_max: z.number().positive().max(1).default(0.30),
  delta_abs_min: z.number().nonnegative().max(1).default(0.10),
  iv_rank_min: z.number().min(0).max(100).default(30),
  min_credit: z.number().nonnegative().default(0.25),
  min_yor: z.number().nonnegative().default(0.08),
  min_oi: z.number().int().nonnegative().default(100),
  min_mkt_cap_usd: z.number().nonnegative().default(500_000_000),
  avoid_earnings_within_dte: z.boolean().default(true),
  max_results: z.number().int().positive().max(100).default(25),
  spread_width: z.number().positive().optional(),
});

type Args = z.infer<typeof ScreenOptionsArgs>;

interface Candidate {
  ticker: string;
  strategy: string;
  short_strike: number;
  long_strike?: number | undefined;
  expiry: string;
  dte: number;
  credit: number;
  max_risk?: number | undefined;
  yor?: number | undefined;
  short_delta: number;
  pop: number;
  iv?: number | undefined;
  iv_rank?: number | undefined;
  oi: number;
  volume?: number | undefined;
  underlying_price?: number | undefined;
  market_cap_usd?: number | undefined;
  sector?: string | undefined;
  earnings_date?: string | undefined;
  earnings_in_window: boolean;
  score: number;
  notes: string[];
}

function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate}T16:00:00-04:00`).getTime();
  return Math.round((target - Date.now()) / 86_400_000);
}

function isBetween(iso: string | undefined, minDte: number, maxDte: number): boolean {
  if (!iso) return false;
  const d = daysUntil(iso);
  return d >= minDte && d <= maxDte;
}

export async function screenOptionsHandler(raw: unknown): Promise<{
  candidates: Candidate[];
  skipped: { ticker: string; reason: string }[];
}> {
  const args = ScreenOptionsArgs.parse(raw);
  const candidates: Candidate[] = [];
  const skipped: { ticker: string; reason: string }[] = [];

  for (const rawTicker of args.tickers) {
    const ticker = rawTicker.toUpperCase();
    try {
      const [profile, earnings, ivRank, state] = await Promise.all([
        finnhubProfile(ticker),
        finnhubEarnings(ticker),
        uwIvRank(ticker),
        uwStockState(ticker),
      ]);

      if (profile.market_cap_usd !== undefined && profile.market_cap_usd < args.min_mkt_cap_usd) {
        skipped.push({ ticker, reason: `mkt_cap ${profile.market_cap_usd} < min ${args.min_mkt_cap_usd}` });
        continue;
      }
      if (ivRank.iv_rank !== undefined && ivRank.iv_rank < args.iv_rank_min) {
        skipped.push({ ticker, reason: `iv_rank ${ivRank.iv_rank} < min ${args.iv_rank_min}` });
        continue;
      }

      const expiries = await uwExpiryList(ticker);
      const eligibleExpiries = expiries.filter((e) => isBetween(e, args.dte_min, args.dte_max));
      if (eligibleExpiries.length === 0) {
        skipped.push({ ticker, reason: `no expiries in DTE [${args.dte_min}, ${args.dte_max}]` });
        continue;
      }

      for (const expiry of eligibleExpiries) {
        const dte = daysUntil(expiry);
        const earningsInWindow = earnings.next_earnings_date
          ? daysUntil(earnings.next_earnings_date) <= dte && daysUntil(earnings.next_earnings_date) >= 0
          : false;
        if (args.avoid_earnings_within_dte && earningsInWindow) continue;

        const chain = await uwOptionChain(ticker, expiry);
        const isPutSide = args.strategy === "csp" || args.strategy === "pcs";
        const optionType = isPutSide ? "put" : "call";
        const legs = chain.filter((c) => c.type === optionType);
        for (const leg of legs) {
          if (leg.delta === undefined || leg.mid === undefined || leg.open_interest === undefined) continue;
          const absDelta = Math.abs(leg.delta);
          if (absDelta < args.delta_abs_min || absDelta > args.delta_abs_max) continue;
          if (leg.open_interest < args.min_oi) continue;

          const credit = leg.mid;
          if (credit < args.min_credit) continue;

          let longStrike: number | undefined;
          let maxRisk: number | undefined;
          let netCredit = credit;

          if (args.strategy === "pcs" || args.strategy === "ccs") {
            const width = args.spread_width ?? 5;
            longStrike = isPutSide ? leg.strike - width : leg.strike + width;
            const longLeg = legs.find((c) => c.strike === longStrike);
            if (!longLeg?.mid) continue;
            netCredit = credit - longLeg.mid;
            if (netCredit < args.min_credit) continue;
            maxRisk = width - netCredit;
            if (maxRisk <= 0) continue;
          }

          const yor = maxRisk !== undefined ? netCredit / maxRisk : netCredit / leg.strike;
          if (yor < args.min_yor) continue;

          const pop = 1 - absDelta;
          const score = yor * pop * (1 + (ivRank.iv_rank ?? 30) / 200);
          const notes: string[] = [];
          if (earningsInWindow) notes.push("earnings_in_window");
          if (ivRank.iv_rank !== undefined && ivRank.iv_rank > 60) notes.push("high_iv_rank");
          if (leg.volume !== undefined && leg.volume > (leg.open_interest ?? 0)) notes.push("unusual_vol");

          candidates.push({
            ticker,
            strategy: args.strategy,
            short_strike: leg.strike,
            long_strike: longStrike,
            expiry,
            dte,
            credit: Number(netCredit.toFixed(2)),
            max_risk: maxRisk !== undefined ? Number(maxRisk.toFixed(2)) : undefined,
            yor: Number(yor.toFixed(4)),
            short_delta: Number(leg.delta.toFixed(4)),
            pop: Number(pop.toFixed(4)),
            iv: leg.iv,
            iv_rank: ivRank.iv_rank,
            oi: leg.open_interest,
            volume: leg.volume,
            underlying_price: state.price,
            market_cap_usd: profile.market_cap_usd,
            sector: profile.sector,
            earnings_date: earnings.next_earnings_date,
            earnings_in_window: earningsInWindow,
            score: Number(score.toFixed(4)),
            notes,
          });
        }
      }
    } catch (err) {
      skipped.push({ ticker, reason: (err as Error).message.slice(0, 200) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    candidates: candidates.slice(0, args.max_results),
    skipped,
  };
}
