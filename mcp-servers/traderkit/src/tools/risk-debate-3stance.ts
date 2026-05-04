import { z } from "zod";

export const RiskDebate3StanceArgs = z.object({
  proposal: z.object({
    ticker: z.string().min(1),
    structure: z.string().optional().default("unknown"),
    direction: z.enum(["BUY", "SELL", "BUY_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_OPEN", "SELL_TO_CLOSE"]).default("BUY_TO_OPEN"),
    notional_usd: z.number().nonnegative().default(0),
    contracts: z.number().nonnegative().default(0),
  }),
  portfolio_state: z
    .object({
      nav_usd: z.number().nonnegative().optional(),
      ticker_pct: z.number().min(0).max(100).optional(),
      tier_cap_pct: z.number().min(0).max(100).optional(),
      margin_drawn_usd: z.number().optional(),
      held_into_earnings: z.boolean().optional(),
    })
    .optional()
    .default({}),
  regime_tier: z.enum(["CLEAR", "CAUTION", "DEFENSIVE", "HALT"]).default("CLEAR"),
  rules_text: z.string().optional().default(""),
  research_manager: z
    .object({
      rating: z.enum(["Buy", "Overweight", "Hold", "Underweight", "Sell"]).optional(),
      conviction: z.number().min(1).max(5).optional(),
      signal_score: z.number().min(0).max(100).optional(),
    })
    .optional()
    .default({}),
  r_violations: z.array(z.string()).optional().default([]),
});

type Verdict = "APPROVE" | "MODIFY" | "BLOCK";

interface StanceResult {
  verdict: Verdict;
  size_multiplier: number;
  argument: string;
  citations: string[];
}

const REGIME_BASE_SIZE: Record<string, number> = {
  CLEAR: 1.0,
  CAUTION: 0.75,
  DEFENSIVE: 0.5,
  HALT: 0.25,
};

function aggressiveStance(args: z.infer<typeof RiskDebate3StanceArgs>, hard_block: string[]): StanceResult {
  const cites: string[] = [];
  const reasons: string[] = [];

  if (hard_block.length > 0) {
    return {
      verdict: "BLOCK",
      size_multiplier: 0,
      argument: `Even the aggressive stance respects HARD blocks: ${hard_block.join(", ")}.`,
      citations: hard_block,
    };
  }

  let size = 1.5; // aggressive bonus
  reasons.push("Conservative cases routinely under-sample upside; the bull thesis surfaced concrete catalysts that justify a full-fat allocation.");
  if (args.research_manager.rating === "Buy" && (args.research_manager.conviction ?? 3) >= 4) {
    reasons.push(`Research-manager Buy/${args.research_manager.conviction}: lean in.`);
    cites.push(`RM=Buy/${args.research_manager.conviction}`);
  }
  if (args.regime_tier === "CLEAR") {
    reasons.push("Regime CLEAR — no reason to discount sizing.");
  } else {
    size *= REGIME_BASE_SIZE[args.regime_tier] ?? 0.5;
    reasons.push(`Even at ${args.regime_tier}, asymmetric setups deserve at least ${size.toFixed(2)}× of plan size.`);
  }
  const verdict: Verdict = "APPROVE";
  return {
    verdict,
    size_multiplier: Math.min(1.5, Math.max(0, Math.round(size * 100) / 100)),
    argument: reasons.join(" "),
    citations: cites,
  };
}

function conservativeStance(args: z.infer<typeof RiskDebate3StanceArgs>, hard_block: string[]): StanceResult {
  const cites: string[] = [];
  const reasons: string[] = [];

  if (hard_block.length > 0) {
    return {
      verdict: "BLOCK",
      size_multiplier: 0,
      argument: `BLOCK — hard violations dominate: ${hard_block.join(", ")}. No aggressive case overrides these.`,
      citations: hard_block,
    };
  }

  let size = 0.5;
  let verdict: Verdict = "MODIFY";

  if (args.regime_tier === "HALT") {
    size = 0;
    verdict = "BLOCK";
    reasons.push("Regime HALT — capital preservation dominates; no opening trade.");
    cites.push("regime=HALT");
  } else if (args.regime_tier === "DEFENSIVE") {
    size = 0.35;
    reasons.push("Regime DEFENSIVE — accept smaller size, prefer defined-risk structures.");
    cites.push("regime=DEFENSIVE");
  } else if (args.regime_tier === "CAUTION") {
    size = 0.5;
    reasons.push("CAUTION regime — half size at most, watch tail-risk.");
    cites.push("regime=CAUTION");
  } else {
    size = 0.75;
    reasons.push("Even in CLEAR regime, capital preservation prefers <1× of trader's plan until thesis is proven.");
  }

  // Concentration concern
  if (args.portfolio_state.ticker_pct !== undefined && args.portfolio_state.tier_cap_pct !== undefined) {
    const headroom = args.portfolio_state.tier_cap_pct - args.portfolio_state.ticker_pct;
    if (headroom < 5) {
      size = Math.min(size, 0.25);
      reasons.push(`Concentration headroom only ${headroom.toFixed(1)}% — reduce sharply.`);
      cites.push(`headroom=${headroom.toFixed(1)}%`);
    }
  }

  if (args.research_manager.rating === "Hold" || args.research_manager.rating === "Underweight") {
    verdict = "BLOCK";
    size = 0;
    reasons.push(`Research-manager rating ${args.research_manager.rating} — defer.`);
    cites.push(`RM=${args.research_manager.rating}`);
  }

  if (args.portfolio_state.held_into_earnings) {
    reasons.push("Held into earnings — defer until after the print or use defined-risk wing.");
  }

  return {
    verdict,
    size_multiplier: Math.min(1.0, Math.max(0, Math.round(size * 100) / 100)),
    argument: reasons.join(" "),
    citations: cites,
  };
}

function neutralStance(args: z.infer<typeof RiskDebate3StanceArgs>, agg: StanceResult, con: StanceResult, hard_block: string[]): StanceResult {
  const cites: string[] = [];
  const reasons: string[] = [];

  if (hard_block.length > 0) {
    return {
      verdict: "BLOCK",
      size_multiplier: 0,
      argument: `Neutral concurs: hard violations override the aggressive case. Fix the violations or skip.`,
      citations: hard_block,
    };
  }

  // Neutral = midpoint biased toward conservative when regime tightens
  const tilt = args.regime_tier === "CLEAR" ? 0.5 : args.regime_tier === "CAUTION" ? 0.4 : args.regime_tier === "DEFENSIVE" ? 0.3 : 0.2;
  let size = agg.size_multiplier * tilt + con.size_multiplier * (1 - tilt);
  size = Math.round(size * 100) / 100;

  let verdict: Verdict;
  if (con.verdict === "BLOCK") {
    verdict = "BLOCK";
    size = 0;
    reasons.push("Conservative BLOCK is decisive; aggressive case can't overcome hard veto.");
    cites.push(...con.citations);
  } else if (size >= 0.85) {
    verdict = "APPROVE";
    reasons.push("Aggressive + conservative converge near full size — clean APPROVE.");
  } else if (size >= 0.4) {
    verdict = "MODIFY";
    reasons.push(`Balanced view: take ${size.toFixed(2)}× of trader's plan with the conservative-suggested guardrails.`);
  } else {
    verdict = "BLOCK";
    reasons.push("Probability-weighted, the trade does not justify even half size — skip or wait.");
  }

  if (args.research_manager.signal_score !== undefined && args.research_manager.signal_score < 40) {
    reasons.push("Signal score sub-TIER-1 — neutral defers absent tactical-hedge flag.");
    cites.push(`signal=${args.research_manager.signal_score}`);
    verdict = "BLOCK";
    size = 0;
  }

  return {
    verdict,
    size_multiplier: Math.max(0, size),
    argument: reasons.join(" "),
    citations: cites,
  };
}

function detectHardBlocks(args: z.infer<typeof RiskDebate3StanceArgs>): string[] {
  const out: string[] = [];
  if (args.r_violations.length > 0) out.push(`R-violations: ${args.r_violations.join(",")}`);
  if (args.portfolio_state.margin_drawn_usd !== undefined && args.portfolio_state.margin_drawn_usd > 0) {
    out.push(`MARGIN_DEBIT $${args.portfolio_state.margin_drawn_usd}`);
  }
  if (args.portfolio_state.ticker_pct !== undefined && args.portfolio_state.tier_cap_pct !== undefined) {
    if (args.portfolio_state.ticker_pct > args.portfolio_state.tier_cap_pct) {
      out.push(`OVER_CAP ${args.portfolio_state.ticker_pct.toFixed(1)}% > ${args.portfolio_state.tier_cap_pct.toFixed(1)}%`);
    }
  }
  if (args.regime_tier === "HALT" && args.proposal.direction.startsWith("BUY")) {
    // Opening buy under HALT = hard block (matches RegimeGate)
    out.push("REGIME_HALT_OPENING_BUY");
  }
  // Scan rules text for explicit "BLOCK" markers
  if (/\bMARGIN_DEBIT\b|\bover[\s_-]?cap\b|\bwash[\s_-]?sale\b\s*=\s*violation/i.test(args.rules_text)) {
    out.push("rules_text_violation");
  }
  return out;
}

export async function riskDebate3StanceHandler(raw: unknown) {
  const args = RiskDebate3StanceArgs.parse(raw);
  const hard_block = detectHardBlocks(args);

  const aggressive = aggressiveStance(args, hard_block);
  const conservative = conservativeStance(args, hard_block);
  const neutral = neutralStance(args, aggressive, conservative, hard_block);

  // Consensus: if any stance is BLOCK due to hard violations, consensus is BLOCK
  let consensus_verdict: Verdict;
  let size_multiplier: number;

  if (hard_block.length > 0 || conservative.verdict === "BLOCK" || neutral.verdict === "BLOCK") {
    consensus_verdict = "BLOCK";
    size_multiplier = 0;
  } else if (aggressive.verdict === "APPROVE") {
    // Use neutral's size as the balanced answer
    consensus_verdict = neutral.verdict;
    size_multiplier = neutral.size_multiplier;
  } else {
    consensus_verdict = "MODIFY";
    size_multiplier = neutral.size_multiplier;
  }

  return {
    ticker: args.proposal.ticker,
    aggressive: { verdict: aggressive.verdict, size_multiplier: aggressive.size_multiplier, argument: aggressive.argument, citations: aggressive.citations },
    conservative: { verdict: conservative.verdict, size_multiplier: conservative.size_multiplier, argument: conservative.argument, citations: conservative.citations },
    neutral: { verdict: neutral.verdict, size_multiplier: neutral.size_multiplier, argument: neutral.argument, citations: neutral.citations },
    consensus_verdict,
    size_multiplier,
    hard_blocks: hard_block,
  };
}
