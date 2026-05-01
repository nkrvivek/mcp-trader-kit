export type KellyRecommendation = "DO NOT BET" | "STRONG" | "MARGINAL" | "WEAK";

export interface KellyResult {
  full_kelly_pct: number;
  fractional_kelly_pct: number;
  fraction_used: number;
  edge_exists: boolean;
  recommendation: KellyRecommendation;
}

export function kelly(probWin: number, odds: number, fraction = 0.25): KellyResult {
  if (odds <= 0) {
    return {
      full_kelly_pct: 0,
      fractional_kelly_pct: 0,
      fraction_used: fraction,
      edge_exists: false,
      recommendation: "DO NOT BET",
    };
  }
  const q = 1 - probWin;
  const fullKelly = probWin - q / odds;
  const fracKelly = fullKelly * fraction;
  return {
    full_kelly_pct: round2(fullKelly * 100),
    fractional_kelly_pct: round2(fracKelly * 100),
    fraction_used: fraction,
    edge_exists: fullKelly > 0,
    recommendation:
      fullKelly <= 0
        ? "DO NOT BET"
        : fullKelly > 0.10
          ? "STRONG"
          : fullKelly > 0.025
            ? "MARGINAL"
            : "WEAK",
  };
}

export interface KellyBatchInput {
  probWin: number;
  odds: number;
}

export interface KellyBatchSize {
  prob_win: number;
  odds: number;
  full_kelly_pct: number;
  fractional_kelly_pct: number;
  dollar_size: number;
  capped: boolean;
  recommendation: KellyRecommendation;
}

export function kellyBatch(
  inputs: readonly KellyBatchInput[],
  bankroll: number,
  fraction = 0.25,
  maxPct = 0.025,
): KellyBatchSize[] {
  const cap = bankroll * maxPct;
  return inputs.map(({ probWin, odds }) => {
    const r = kelly(probWin, odds, fraction);
    const rawDollar = (bankroll * r.fractional_kelly_pct) / 100;
    const dollar = Math.min(Math.max(rawDollar, 0), cap);
    return {
      prob_win: probWin,
      odds,
      full_kelly_pct: r.full_kelly_pct,
      fractional_kelly_pct: r.fractional_kelly_pct,
      dollar_size: round2(dollar),
      capped: rawDollar > cap,
      recommendation: r.recommendation,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
