import { z } from "zod";

export const SynthesizeDebateArgs = z.object({
  ticker: z.string().min(1),
  bull_argument: z.string().default(""),
  bear_argument: z.string().default(""),
  context: z
    .object({
      regime_tier: z.enum(["CLEAR", "CAUTION", "DEFENSIVE", "HALT"]).optional(),
      signal_score: z.number().min(0).max(100).optional(),
      thesis_alignment_pct: z.number().min(0).max(100).optional(),
      tier_cap_headroom_pct: z.number().optional(),
      r_violations: z.array(z.string()).optional(),
    })
    .optional()
    .default({}),
});

const RATING_SCALE = ["Sell", "Underweight", "Hold", "Overweight", "Buy"] as const;
type Rating = (typeof RATING_SCALE)[number];

const VERDICT_BY_RATING: Record<Rating, "BUY" | "HOLD" | "SELL"> = {
  Buy: "BUY",
  Overweight: "BUY",
  Hold: "HOLD",
  Underweight: "SELL",
  Sell: "SELL",
};

// Score one side of the debate by counting concrete evidence markers.
function scoreArgument(text: string): { strength: number; evidence_count: number; r_rule_citations: number; rebuttal_count: number } {
  if (!text.trim()) return { strength: 0, evidence_count: 0, r_rule_citations: 0, rebuttal_count: 0 };
  const lower = text.toLowerCase();

  // Specific evidence: numeric claims, % changes, dates, ticker citations
  const numeric = (text.match(/\b\d+(?:\.\d+)?%/g) ?? []).length;
  const dollars = (text.match(/\$\d+(?:[,.]\d+)*/g) ?? []).length;
  const dates = (text.match(/\b\d{4}-\d{2}-\d{2}\b|\bQ[1-4]\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g) ?? []).length;
  const cited_reports = (text.match(/per\s+(?:fundamentals|market|news|sentiment|thesis)/gi) ?? []).length;

  // R-rule citations (bear-side specialty)
  const r_rules = (text.match(/\bR\d{1,2}\b/g) ?? []).length;

  // Rebuttal markers — counter-arguments to the other side
  const rebuttals = (text.match(/\b(?:however|but|actually|counter|disagree|wrong|misses|overlooks|underweights|overstated|understated)\b/gi) ?? []).length;

  // Length-based ceiling: very short args can't carry much
  const length_factor = Math.min(1, text.length / 800);

  const evidence_count = numeric + dollars + dates + cited_reports;
  const strength = (evidence_count * 1.0 + r_rules * 1.5 + rebuttals * 0.5) * length_factor;

  return { strength, evidence_count, r_rule_citations: r_rules, rebuttal_count: rebuttals };
}

function pickRating(net: number, ctx: NonNullable<z.infer<typeof SynthesizeDebateArgs>["context"]>): Rating {
  // net = (bull - bear) / (bull + bear), in [-1, 1]
  // Adjust for hard-context floors
  if (ctx.r_violations && ctx.r_violations.length > 0) return "Hold";
  if (ctx.regime_tier === "HALT") {
    return net > 0.3 ? "Hold" : "Underweight";
  }
  if (typeof ctx.signal_score === "number" && ctx.signal_score < 40) {
    // Sub-TIER-1 caps at Hold/Underweight
    return net > 0.3 ? "Hold" : "Underweight";
  }
  if (net >= 0.5) return "Buy";
  if (net >= 0.15) return "Overweight";
  if (net > -0.15) return "Hold";
  if (net > -0.5) return "Underweight";
  return "Sell";
}

function pickConviction(net: number, bull_strength: number, bear_strength: number): 1 | 2 | 3 | 4 | 5 {
  const total = bull_strength + bear_strength;
  if (total < 2) return 1; // both sides too thin
  const abs = Math.abs(net);
  if (abs >= 0.6 && total >= 8) return 5;
  if (abs >= 0.4 && total >= 6) return 4;
  if (abs >= 0.2) return 3;
  if (abs >= 0.05) return 2;
  return 1;
}

function extractKeyRisks(bear: string): string[] {
  const out: string[] = [];
  // Capture bullets + R-rule lines
  for (const m of bear.matchAll(/^[-*•]\s+(.{10,180})$/gm)) {
    if (m[1]) out.push(m[1].trim().replace(/\s+/g, " "));
    if (out.length >= 5) break;
  }
  if (out.length === 0) {
    // Fall back to sentences w/ risk markers
    const sentences = bear.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      if (/\b(?:risk|warning|concern|threat|R\d+|violation|cap|breach|debt|dilut)/i.test(s)) {
        out.push(s.trim().slice(0, 180));
        if (out.length >= 5) break;
      }
    }
  }
  return out;
}

function summarizeThesis(bull: string, ticker: string, rating: Rating): string {
  const verdict = VERDICT_BY_RATING[rating];
  const m = bull.match(/^[^\n.!?]{20,160}/);
  const headline = (m && m[0] ? m[0] : `Inconclusive thesis for ${ticker}.`).trim();
  return `${ticker} → ${rating} (${verdict}). ${headline.replace(/^bull analyst:?\s*/i, "")}`;
}

function sizingNotes(rating: Rating, conviction: number, ctx: NonNullable<z.infer<typeof SynthesizeDebateArgs>["context"]>): string {
  const verdict = VERDICT_BY_RATING[rating];
  const parts: string[] = [];
  if (verdict === "HOLD" || verdict === "SELL") {
    parts.push("No new opening size; close/roll only as appropriate.");
  } else {
    const base = conviction >= 4 ? "full plan size" : conviction === 3 ? "0.75× plan size" : "0.5× plan size — half-position pilot";
    parts.push(base);
  }
  if (ctx.regime_tier === "DEFENSIVE") parts.push("regime DEFENSIVE → cap at 0.5× and prefer defined-risk");
  if (ctx.regime_tier === "CAUTION") parts.push("regime CAUTION → 0.75× size cap");
  if (typeof ctx.tier_cap_headroom_pct === "number" && ctx.tier_cap_headroom_pct < 2) parts.push(`tier-cap headroom ${ctx.tier_cap_headroom_pct.toFixed(1)}% — reduce or skip`);
  if (ctx.r_violations && ctx.r_violations.length > 0) parts.push(`R-violations present: ${ctx.r_violations.join(", ")} — BLOCK`);
  return parts.join(" · ");
}

export async function synthesizeDebateHandler(raw: unknown) {
  const args = SynthesizeDebateArgs.parse(raw);
  const bull = scoreArgument(args.bull_argument);
  const bear = scoreArgument(args.bear_argument);

  const total = bull.strength + bear.strength;
  const net = total > 0 ? (bull.strength - bear.strength) / total : 0;

  const rating = pickRating(net, args.context);
  const conviction = pickConviction(net, bull.strength, bear.strength);
  const verdict = VERDICT_BY_RATING[rating];

  const key_risks = extractKeyRisks(args.bear_argument);
  const thesis_summary = summarizeThesis(args.bull_argument, args.ticker, rating);
  const position_sizing_notes = sizingNotes(rating, conviction, args.context);

  return {
    ticker: args.ticker,
    verdict,
    rating,
    conviction,
    net_strength: Math.round(net * 100) / 100,
    bull_score: Math.round(bull.strength * 10) / 10,
    bear_score: Math.round(bear.strength * 10) / 10,
    bull_evidence_count: bull.evidence_count,
    bear_evidence_count: bear.evidence_count,
    bear_r_rule_citations: bear.r_rule_citations,
    key_risks,
    thesis_summary,
    position_sizing_notes,
    warnings: total < 2 ? ["both arguments thin — low-confidence verdict"] : [],
  };
}
