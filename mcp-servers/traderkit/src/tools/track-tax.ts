import { z } from "zod";

const RealizedTrade = z.object({
  ticker: z.string().min(1),
  realized_pnl: z.number(),
  hold_days: z.number().nonnegative(),
  date: z.string().min(1),
  broker: z.string().optional(),
  wash_sale_adjusted: z.boolean().default(false),
});

export const TrackTaxArgs = z.object({
  trades: z.array(RealizedTrade),
  stcg_rate: z.number().min(0).max(1).default(0.358),
  ltcg_rate: z.number().min(0).max(1).default(0.188),
  lt_threshold_days: z.number().nonnegative().default(365),
});

interface TaxBucket {
  total_pnl: number;
  gain: number;
  loss: number;
  count: number;
  rate: number;
  reserve: number;
}

export async function trackTaxHandler(raw: unknown) {
  const args = TrackTaxArgs.parse(raw);

  const stcg: TaxBucket = { total_pnl: 0, gain: 0, loss: 0, count: 0, rate: args.stcg_rate, reserve: 0 };
  const ltcg: TaxBucket = { total_pnl: 0, gain: 0, loss: 0, count: 0, rate: args.ltcg_rate, reserve: 0 };

  const breakdown: Array<{
    ticker: string;
    date: string;
    realized_pnl: number;
    hold_days: number;
    term: "STCG" | "LTCG";
    tax_impact: number;
    wash_sale_adjusted: boolean;
  }> = [];

  for (const t of args.trades) {
    const isLong = t.hold_days >= args.lt_threshold_days;
    const bucket = isLong ? ltcg : stcg;
    const term = isLong ? "LTCG" as const : "STCG" as const;

    bucket.total_pnl += t.realized_pnl;
    bucket.count++;
    if (t.realized_pnl >= 0) {
      bucket.gain += t.realized_pnl;
    } else {
      bucket.loss += t.realized_pnl;
    }

    breakdown.push({
      ticker: t.ticker,
      date: t.date,
      realized_pnl: round(t.realized_pnl),
      hold_days: t.hold_days,
      term,
      tax_impact: round(Math.max(0, t.realized_pnl) * bucket.rate),
      wash_sale_adjusted: t.wash_sale_adjusted,
    });
  }

  stcg.reserve = round(Math.max(0, stcg.total_pnl) * stcg.rate);
  ltcg.reserve = round(Math.max(0, ltcg.total_pnl) * ltcg.rate);

  const netPnl = round(stcg.total_pnl + ltcg.total_pnl);
  const totalReserve = round(stcg.reserve + ltcg.reserve);
  const effectiveRate = netPnl > 0 ? round(totalReserve / netPnl) : 0;

  return {
    summary: {
      net_realized_pnl: netPnl,
      total_tax_reserve: totalReserve,
      effective_rate: effectiveRate,
      stcg: {
        total_pnl: round(stcg.total_pnl),
        gain: round(stcg.gain),
        loss: round(stcg.loss),
        count: stcg.count,
        rate: stcg.rate,
        reserve: stcg.reserve,
      },
      ltcg: {
        total_pnl: round(ltcg.total_pnl),
        gain: round(ltcg.gain),
        loss: round(ltcg.loss),
        count: ltcg.count,
        rate: ltcg.rate,
        reserve: ltcg.reserve,
      },
    },
    breakdown: breakdown.sort((a, b) => a.date.localeCompare(b.date)),
    wash_sale_count: args.trades.filter((t) => t.wash_sale_adjusted).length,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
