import { z } from "zod";
import { fmpQuote, fmpDcf, fmpPriceTarget, fmpEarnings } from "../clients/fmp-client.js";

export const FmpFundamentalsArgs = z.object({
  tickers: z.array(z.string().min(1)).min(1).max(25)
    .describe("1–25 ticker symbols. FMP free tier is 250 calls/day."),
  include: z.array(z.enum(["quote", "dcf", "target", "earnings"]))
    .optional()
    .describe("Subset of fields to fetch per ticker. Default: all four."),
  earnings_window_days: z.number().int().min(1).max(180).default(60)
    .describe("Earnings-calendar window (days forward from today)."),
});

export type FmpFundamentalsInput = z.infer<typeof FmpFundamentalsArgs>;

export interface FmpFundamentalsRow {
  ticker: string;
  spot?: number | undefined;
  market_cap_usd?: number | undefined;
  change_pct?: number | undefined;
  dcf?: number | undefined;
  dcf_vs_spot_pct?: number | undefined;
  target_high?: number | undefined;
  target_low?: number | undefined;
  target_median?: number | undefined;
  target_consensus?: number | undefined;
  target_vs_spot_pct?: number | undefined;
  next_earnings_date?: string | undefined;
  earnings_timing?: "bmo" | "amc" | "unknown" | undefined;
  eps_estimated?: number | undefined;
  revenue_estimated?: number | undefined;
  errors?: string[] | undefined;
}

export async function fmpFundamentalsHandler(
  raw: unknown,
): Promise<{ rows: FmpFundamentalsRow[] }> {
  const args = FmpFundamentalsArgs.parse(raw);
  const include = new Set(args.include ?? ["quote", "dcf", "target", "earnings"]);
  const today = new Date();
  const fromIso = today.toISOString().slice(0, 10);
  const toIso = new Date(today.getTime() + args.earnings_window_days * 86_400_000)
    .toISOString().slice(0, 10);

  const rows = await Promise.all(args.tickers.map(async (rawTicker) => {
    const T = rawTicker.toUpperCase();
    const row: FmpFundamentalsRow = { ticker: T };
    const errors: string[] = [];
    const tasks: Promise<void>[] = [];

    const catchInto = (label: string) => (e: unknown): void => {
      errors.push(`${label}: ${(e as Error).message}`);
    };

    if (include.has("quote")) {
      tasks.push(
        fmpQuote(T).then((q): void => {
          row.spot = q.price;
          row.market_cap_usd = q.market_cap_usd;
          row.change_pct = q.change_pct;
        }).catch(catchInto("quote")),
      );
    }
    if (include.has("dcf")) {
      tasks.push(
        fmpDcf(T).then((d): void => {
          row.dcf = d.dcf;
          if (d.dcf !== undefined && d.stock_price) {
            row.dcf_vs_spot_pct = (d.dcf / d.stock_price - 1) * 100;
          }
        }).catch(catchInto("dcf")),
      );
    }
    if (include.has("target")) {
      tasks.push(
        fmpPriceTarget(T).then((p): void => {
          row.target_high = p.target_high;
          row.target_low = p.target_low;
          row.target_median = p.target_median;
          row.target_consensus = p.target_consensus;
        }).catch(catchInto("target")),
      );
    }
    if (include.has("earnings")) {
      tasks.push(
        fmpEarnings(T, fromIso, toIso).then((e): void => {
          row.next_earnings_date = e.next_earnings_date;
          row.earnings_timing = e.timing;
          row.eps_estimated = e.eps_estimated;
          row.revenue_estimated = e.revenue_estimated;
        }).catch(catchInto("earnings")),
      );
    }

    await Promise.all(tasks);
    if (row.target_consensus !== undefined && row.spot !== undefined) {
      row.target_vs_spot_pct = (row.target_consensus / row.spot - 1) * 100;
    }
    if (errors.length) row.errors = errors;
    return row;
  }));

  return { rows };
}
