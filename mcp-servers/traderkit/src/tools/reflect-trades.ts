import { z } from "zod";

const ClosedTradeSchema = z.object({
  ticker: z.string().min(1),
  structure: z.string().optional().default("unknown"),
  outcome: z.enum(["WIN_MANAGED", "WIN_EXPIRED", "LOSS_STOPPED", "LOSS_ASSIGNED", "LOSS_ROLLED", "BREAKEVEN", "UNCATEGORIZED"]).optional(),
  pnl_usd: z.number().optional().default(0),
  return_pct: z.number().optional(),
  closed_at: z.string().optional(), // ISO date
  hold_days: z.number().nonnegative().optional(),
  exit_reason: z.string().optional(),
  r_rule_breaches: z.array(z.string()).optional().default([]),
  was_roll: z.boolean().optional().default(false),
  roll_count: z.number().nonnegative().optional().default(0),
  thesis_ref: z.string().optional(),
  regime_tier_at_open: z.enum(["CLEAR", "CAUTION", "DEFENSIVE", "HALT"]).optional(),
});

export const ReflectTradesArgs = z.object({
  book: z.enum(["bildof", "personal"]).default("personal"),
  lookback_days: z.number().positive().default(30),
  trades: z.array(ClosedTradeSchema).default([]),
});

interface Lesson {
  id: string;
  category: "r_rule" | "concentration" | "revenge_roll" | "regime_misread" | "structure_drift" | "exit_discipline";
  text: string;
  evidence: string[];
  severity: "low" | "medium" | "high";
}

function pct(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.round((n / d) * 1000) / 10;
}

export async function reflectTradesHandler(raw: unknown) {
  const args = ReflectTradesArgs.parse(raw);
  const trades = args.trades;

  // Aggregate metrics
  const total = trades.length;
  const wins = trades.filter((t) => t.outcome?.startsWith("WIN")).length;
  const losses = trades.filter((t) => t.outcome?.startsWith("LOSS")).length;
  const total_pnl = trades.reduce((s, t) => s + (t.pnl_usd ?? 0), 0);

  // R-rule breach inventory
  const r_rule_breach_count: Record<string, number> = {};
  const r_rule_examples: Record<string, string[]> = {};
  for (const t of trades) {
    for (const r of t.r_rule_breaches ?? []) {
      r_rule_breach_count[r] = (r_rule_breach_count[r] ?? 0) + 1;
      r_rule_examples[r] = r_rule_examples[r] ?? [];
      if (r_rule_examples[r].length < 3) {
        r_rule_examples[r].push(`${t.ticker} ${t.structure} ${t.closed_at ?? ""}`.trim());
      }
    }
  }
  const r_rule_breaches = Object.entries(r_rule_breach_count)
    .map(([rule, count]) => ({ rule, count, examples: r_rule_examples[rule] }))
    .sort((a, b) => b.count - a.count);

  // Revenge-roll detection: roll_count >= 2 AND outcome=LOSS_ROLLED OR LOSS_ASSIGNED
  const revenge_rolls = trades.filter((t) => (t.roll_count ?? 0) >= 2 && (t.outcome === "LOSS_ROLLED" || t.outcome === "LOSS_ASSIGNED"));
  const revenge_roll_count = revenge_rolls.length;

  // Pattern drift alerts
  const pattern_drift_alerts: string[] = [];
  // Drift A: win-rate degrading recent vs prior half
  if (total >= 10) {
    const sorted = [...trades].sort((a, b) => (a.closed_at ?? "").localeCompare(b.closed_at ?? ""));
    const half = Math.floor(sorted.length / 2);
    const early = sorted.slice(0, half);
    const recent = sorted.slice(half);
    const early_wr = pct(early.filter((t) => t.outcome?.startsWith("WIN")).length, early.length);
    const recent_wr = pct(recent.filter((t) => t.outcome?.startsWith("WIN")).length, recent.length);
    if (early_wr - recent_wr >= 15) {
      pattern_drift_alerts.push(`Win-rate drift: early ${early_wr}% → recent ${recent_wr}% (drop ≥15pp)`);
    }
  }
  // Drift B: concentration in losses by single ticker
  const loss_by_ticker: Record<string, number> = {};
  for (const t of trades.filter((x) => x.outcome?.startsWith("LOSS"))) {
    loss_by_ticker[t.ticker] = (loss_by_ticker[t.ticker] ?? 0) + 1;
  }
  for (const [tkr, n] of Object.entries(loss_by_ticker)) {
    if (n >= 3) pattern_drift_alerts.push(`${tkr} accounts for ${n} losses — concentration in losers`);
  }
  // Drift C: structure repeatedly losing
  const loss_by_structure: Record<string, number> = {};
  for (const t of trades.filter((x) => x.outcome?.startsWith("LOSS"))) {
    loss_by_structure[t.structure ?? "unknown"] = (loss_by_structure[t.structure ?? "unknown"] ?? 0) + 1;
  }
  for (const [s, n] of Object.entries(loss_by_structure)) {
    if (n >= 4) pattern_drift_alerts.push(`Structure '${s}' lost ${n} times — review thesis or exit discipline`);
  }
  // Drift D: HALT-regime entries
  const halt_entries = trades.filter((t) => t.regime_tier_at_open === "HALT").length;
  if (halt_entries > 0) {
    pattern_drift_alerts.push(`${halt_entries} trades entered under HALT regime — regime gate bypassed`);
  }

  // Build lessons (synthesized from above)
  const lessons: Lesson[] = [];
  for (const r of r_rule_breaches.slice(0, 5)) {
    lessons.push({
      id: `lesson-${r.rule}`,
      category: "r_rule",
      text: `${r.rule} violated ${r.count}× in last ${args.lookback_days}d — wire pre-submit check or auto-skip when triggered.`,
      evidence: r.examples ?? [],
      severity: r.count >= 3 ? "high" : r.count === 2 ? "medium" : "low",
    });
  }
  if (revenge_roll_count > 0) {
    lessons.push({
      id: "lesson-revenge-roll",
      category: "revenge_roll",
      text: `${revenge_roll_count} revenge rolls (≥2 rolls then LOSS) — cap roll attempts at 1 and accept assignment if structure is broken.`,
      evidence: revenge_rolls.slice(0, 3).map((t) => `${t.ticker} ${t.structure} roll_count=${t.roll_count}`),
      severity: revenge_roll_count >= 3 ? "high" : "medium",
    });
  }
  for (const alert of pattern_drift_alerts) {
    lessons.push({
      id: `lesson-drift-${lessons.length}`,
      category: alert.startsWith("Win-rate") ? "exit_discipline" : alert.includes("HALT") ? "regime_misread" : alert.includes("losses") ? "concentration" : "structure_drift",
      text: alert,
      evidence: [],
      severity: "medium",
    });
  }

  // Per-structure summary for context
  const by_structure: Record<string, { trades: number; wins: number; losses: number; pnl_usd: number }> = {};
  for (const t of trades) {
    const s = t.structure ?? "unknown";
    by_structure[s] = by_structure[s] ?? { trades: 0, wins: 0, losses: 0, pnl_usd: 0 };
    by_structure[s].trades++;
    if (t.outcome?.startsWith("WIN")) by_structure[s].wins++;
    else if (t.outcome?.startsWith("LOSS")) by_structure[s].losses++;
    by_structure[s].pnl_usd += t.pnl_usd ?? 0;
  }

  return {
    book: args.book,
    lookback_days: args.lookback_days,
    summary: {
      total_trades: total,
      wins,
      losses,
      win_rate_pct: pct(wins, wins + losses),
      total_pnl_usd: Math.round(total_pnl * 100) / 100,
      revenge_roll_count,
      halt_regime_entries: halt_entries,
    },
    lessons,
    r_rule_breaches,
    pattern_drift_alerts,
    by_structure,
  };
}
