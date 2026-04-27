import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";
import { round } from "../utils/math.js";

const Structure = z.enum([
  "long_stock",
  "short_stock",
  "covered_call",
  "cash_secured_put",
  "put_credit_spread",
  "call_credit_spread",
  "calendar_roll",
  "diagonal_roll",
  "long_call",
  "long_put",
  "naked_call",
  "naked_put",
  "iron_condor",
  "other",
]);

const ExitReason = z.enum([
  "expired_worthless",
  "expired_itm",
  "closed_at_target",
  "stopped_out",
  "rolled",
  "assigned",
  "manual_close",
  "stop_loss_hit",
]);

const TradeInput = z.object({
  ticker: TickerSchema,
  structure: Structure,
  entry_date: z.string(),
  exit_date: z.string(),
  entry_credit_or_debit: z.number(),
  exit_credit_or_debit: z.number().default(0),
  realized_pnl_usd: z.number(),
  exit_reason: ExitReason.optional(),
  managed_at_pct_of_max: z.number().min(0).max(2).optional(),
  thesis_ref: z.string().optional(),
  confluence_tier_at_entry: z.string().optional(),
});

export const ClassifyTradeOutcomeArgs = z.object({
  trades: z.array(TradeInput).min(1),
});

type Outcome =
  | "WIN_MANAGED"
  | "WIN_EXPIRED"
  | "LOSS_STOPPED"
  | "LOSS_ASSIGNED"
  | "LOSS_ROLLED"
  | "BREAKEVEN"
  | "UNCATEGORIZED";

interface ClassifiedTrade {
  ticker: string;
  structure: string;
  outcome: Outcome;
  realized_pnl_usd: number;
  hold_days: number;
  edge_attribution: string[];
  notes: string[];
  thesis_ref: string | null;
  confluence_tier_at_entry: string | null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function classify(t: z.infer<typeof TradeInput>): Outcome {
  if (Math.abs(t.realized_pnl_usd) < 1) return "BREAKEVEN";
  const win = t.realized_pnl_usd > 0;
  const reason = t.exit_reason;

  if (win) {
    if (reason === "closed_at_target" || reason === "manual_close") return "WIN_MANAGED";
    if (reason === "expired_worthless") return "WIN_EXPIRED";
    if (t.managed_at_pct_of_max !== undefined && t.managed_at_pct_of_max >= 0.5) return "WIN_MANAGED";
    return "WIN_EXPIRED";
  }

  if (reason === "assigned" || reason === "expired_itm") return "LOSS_ASSIGNED";
  if (reason === "stopped_out" || reason === "stop_loss_hit") return "LOSS_STOPPED";
  if (reason === "rolled") return "LOSS_ROLLED";
  return "UNCATEGORIZED";
}

function attributeEdge(t: z.infer<typeof TradeInput>, outcome: Outcome): string[] {
  const edges: string[] = [];
  if (t.confluence_tier_at_entry) edges.push(`entry tier=${t.confluence_tier_at_entry}`);
  if (t.thesis_ref) edges.push(`thesis=${t.thesis_ref}`);

  if (outcome === "WIN_EXPIRED" && (t.structure === "covered_call" || t.structure === "cash_secured_put")) {
    edges.push("theta-decay capture (expired worthless)");
  }
  if (outcome === "WIN_MANAGED" && t.managed_at_pct_of_max !== undefined && t.managed_at_pct_of_max >= 0.5) {
    edges.push(`managed at ${Math.round(t.managed_at_pct_of_max * 100)}% of max profit (good discipline)`);
  }
  if (outcome === "LOSS_ASSIGNED") {
    edges.push("assignment risk under-priced or earnings/IV-event collision");
  }
  if (outcome === "LOSS_STOPPED") {
    edges.push("stop hit — review entry tier (was confluence sufficient?)");
  }
  if (outcome === "LOSS_ROLLED") {
    edges.push("rolled at loss — defensive (review for revenge-roll pattern)");
  }
  return edges;
}

export async function classifyTradeOutcomeHandler(raw: unknown) {
  const args = ClassifyTradeOutcomeArgs.parse(raw);
  const classified: ClassifiedTrade[] = args.trades.map((t) => {
    const outcome = classify(t);
    const notes: string[] = [];
    if (!t.exit_reason) notes.push("exit_reason missing — classification used pnl-only fallback");
    return {
      ticker: t.ticker,
      structure: t.structure,
      outcome,
      realized_pnl_usd: round(t.realized_pnl_usd),
      hold_days: daysBetween(t.entry_date, t.exit_date),
      edge_attribution: attributeEdge(t, outcome),
      notes,
      thesis_ref: t.thesis_ref ?? null,
      confluence_tier_at_entry: t.confluence_tier_at_entry ?? null,
    };
  });

  const buckets: Record<Outcome, number> = {
    WIN_MANAGED: 0, WIN_EXPIRED: 0, LOSS_STOPPED: 0, LOSS_ASSIGNED: 0,
    LOSS_ROLLED: 0, BREAKEVEN: 0, UNCATEGORIZED: 0,
  };
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  for (const c of classified) {
    buckets[c.outcome]++;
    totalPnl += c.realized_pnl_usd;
    if (c.outcome === "WIN_MANAGED" || c.outcome === "WIN_EXPIRED") wins++;
    else if (c.outcome.startsWith("LOSS")) losses++;
  }

  const decisive = wins + losses;
  return {
    classified,
    summary: {
      total_trades: classified.length,
      total_realized_pnl_usd: round(totalPnl),
      win_rate: decisive > 0 ? round(wins / decisive) : 0,
      buckets,
      avg_hold_days: round(
        classified.reduce((s, c) => s + c.hold_days, 0) / classified.length,
      ),
    },
  };
}
