import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";

const HoldingInput = z.object({
  ticker: TickerSchema,
  market_value_usd: z.number(),
  has_active_thesis: z.boolean().default(false),
  in_options_program: z.boolean().default(false),
  is_penny_stock: z.boolean().default(false),
});

export const ClassifyHoldingArgs = z.object({
  holdings: z.array(HoldingInput),
  portfolio_total_usd: z.number().positive(),
  tier_thresholds: z.object({
    core_min_pct: z.number().default(10),
    opportunistic_min_pct: z.number().default(3),
    speculative_min_pct: z.number().default(1),
  }).default({ core_min_pct: 10, opportunistic_min_pct: 3, speculative_min_pct: 1 }),
});

type Tier = "CORE" | "OPPORTUNISTIC" | "SPECULATIVE" | "PURE_SPECULATIVE" | "UNCLASSIFIED";

interface ClassifiedHolding {
  ticker: string;
  tier: Tier;
  nav_pct: number;
  market_value_usd: number;
  rationale: string;
}

interface TierSummary {
  tier: Tier;
  count: number;
  total_pct: number;
  total_usd: number;
  tickers: string[];
}

export async function classifyHoldingHandler(raw: unknown) {
  const args = ClassifyHoldingArgs.parse(raw);
  const th = args.tier_thresholds;

  const classified: ClassifiedHolding[] = args.holdings.map((h) => {
    const pct = round((h.market_value_usd / args.portfolio_total_usd) * 100);
    const tier = classify(pct, h.has_active_thesis, h.in_options_program, h.is_penny_stock, th);
    return {
      ticker: h.ticker,
      tier: tier.tier,
      nav_pct: pct,
      market_value_usd: h.market_value_usd,
      rationale: tier.rationale,
    };
  });

  classified.sort((a, b) => b.nav_pct - a.nav_pct);

  const tierOrder: Tier[] = ["CORE", "OPPORTUNISTIC", "SPECULATIVE", "PURE_SPECULATIVE", "UNCLASSIFIED"];
  const summaries: TierSummary[] = tierOrder.map((tier) => {
    const inTier = classified.filter((c) => c.tier === tier);
    return {
      tier,
      count: inTier.length,
      total_pct: round(inTier.reduce((s, c) => s + c.nav_pct, 0)),
      total_usd: round(inTier.reduce((s, c) => s + c.market_value_usd, 0)),
      tickers: inTier.map((c) => c.ticker),
    };
  }).filter((s) => s.count > 0);

  return {
    holdings: classified,
    tier_summary: summaries,
    portfolio_total_usd: args.portfolio_total_usd,
    holding_count: classified.length,
  };
}

function classify(
  pct: number,
  hasThesis: boolean,
  inProgram: boolean,
  isPenny: boolean,
  th: { core_min_pct: number; opportunistic_min_pct: number; speculative_min_pct: number },
): { tier: Tier; rationale: string } {
  if (isPenny && !hasThesis) {
    return { tier: "PURE_SPECULATIVE", rationale: "penny stock without thesis" };
  }

  if (pct >= th.core_min_pct && hasThesis) {
    return { tier: "CORE", rationale: `${pct}% NAV with active thesis` };
  }

  if (pct >= th.core_min_pct && !hasThesis) {
    return { tier: "CORE", rationale: `${pct}% NAV — thesis recommended` };
  }

  if (inProgram && pct < th.opportunistic_min_pct) {
    return { tier: "OPPORTUNISTIC", rationale: "options program member (floor)" };
  }

  if (pct >= th.opportunistic_min_pct) {
    return { tier: "OPPORTUNISTIC", rationale: `${pct}% NAV` };
  }

  if (pct >= th.speculative_min_pct) {
    return { tier: hasThesis ? "SPECULATIVE" : "PURE_SPECULATIVE", rationale: `${pct}% NAV, thesis=${hasThesis}` };
  }

  if (pct > 0) {
    return { tier: "PURE_SPECULATIVE", rationale: `${pct}% NAV — below speculative threshold` };
  }

  return { tier: "UNCLASSIFIED", rationale: "zero value" };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
