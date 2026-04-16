import { z } from "zod";
import type { Profile } from "../profiles/schema.js";
import { TickerSchema } from "../utils/schemas.js";
import { concentrationLabel } from "../utils/concentration.js";

export const CheckConcentrationArgs = z.object({
  profile: z.string().min(1),
  positions: z.array(z.object({
    ticker: TickerSchema,
    market_value_usd: z.number(),
  })),
  portfolio_total_usd: z.number().positive(),
});

export interface ConcentrationEntry {
  ticker: string;
  pct: number;
  market_value_usd: number;
  label: string;
  over_cap_by_pct: number;
}

export async function checkConcentrationHandler(
  raw: unknown,
  deps: { allProfiles: Profile[] }
) {
  const args = CheckConcentrationArgs.parse(raw);
  const profile = deps.allProfiles.find((p) => p.name === args.profile);
  if (!profile) {
    return { violations: [], warnings: [`unknown profile: ${args.profile}`], summary: {} };
  }

  const cap = profile.caps.max_single_name_pct;
  const entries: ConcentrationEntry[] = args.positions
    .map((p) => {
      const pct = (p.market_value_usd / args.portfolio_total_usd) * 100;
      return {
        ticker: p.ticker,
        pct: Math.round(pct * 10) / 10,
        market_value_usd: p.market_value_usd,
        label: concentrationLabel(pct, cap),
        over_cap_by_pct: Math.round(Math.max(0, pct - cap) * 10) / 10,
      };
    })
    .sort((a, b) => b.pct - a.pct);

  const violations = entries.filter((e) => e.label === "OVER-CAP");
  const nearCap = entries.filter((e) => e.label === "NEAR-CAP");

  return {
    cap_pct: cap,
    portfolio_total_usd: args.portfolio_total_usd,
    positions: entries,
    violations: violations.map((v) => ({
      ticker: v.ticker,
      pct: v.pct,
      over_cap_by_pct: v.over_cap_by_pct,
    })),
    warnings: nearCap.map((n) => `${n.ticker} at ${n.pct}% — approaching cap ${cap}%`),
    top_5: entries.slice(0, 5).map((e) => `${e.ticker} ${e.pct}% [${e.label}]`),
    hhi: Math.round(entries.reduce((sum, e) => sum + e.pct * e.pct, 0)),
  };
}
