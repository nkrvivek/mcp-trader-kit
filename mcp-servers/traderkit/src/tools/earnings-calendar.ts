import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";

const EarningsEntry = z.object({
  ticker: TickerSchema,
  earnings_date: z.string(),
  timing: z.enum(["BMO", "AMC", "DMH", "UNKNOWN"]).default("UNKNOWN"),
  consensus_eps: z.number().optional(),
  expected_move_pct: z.number().nonnegative().optional(),
  iv_tier: z.enum(["GREEN", "YELLOW", "RED", "UNKNOWN"]).default("UNKNOWN"),
});

export const EarningsCalendarArgs = z.object({
  as_of: z.string(),
  lookahead_days: z.number().int().positive().max(60).default(14),
  held_tickers: z.array(TickerSchema).default([]),
  watchlist_tickers: z.array(TickerSchema).default([]),
  earnings: z.array(EarningsEntry).default([]),
  open_option_legs: z.array(z.object({
    ticker: TickerSchema,
    expiry: z.string(),
    strike: z.number(),
    right: z.enum(["C", "P"]),
    side: z.enum(["LONG", "SHORT"]),
  })).default([]),
});

interface CalendarRow {
  ticker: string;
  earnings_date: string;
  days_until: number;
  timing: string;
  iv_tier: string;
  expected_move_pct: number | null;
  consensus_eps: number | null;
  status: "HELD" | "WATCHLIST" | "BOTH";
  earnings_window: "OUTSIDE" | "WITHIN_14D" | "WITHIN_7D" | "WITHIN_2D" | "TODAY";
  conflicting_legs: Array<{ expiry: string; strike: number; right: string; side: string; expires_within_earnings: boolean }>;
  flags: string[];
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

function windowOf(daysUntil: number): CalendarRow["earnings_window"] {
  if (daysUntil < 0) return "OUTSIDE";
  if (daysUntil === 0) return "TODAY";
  if (daysUntil <= 2) return "WITHIN_2D";
  if (daysUntil <= 7) return "WITHIN_7D";
  if (daysUntil <= 14) return "WITHIN_14D";
  return "OUTSIDE";
}

export async function earningsCalendarHandler(raw: unknown) {
  const args = EarningsCalendarArgs.parse(raw);
  const heldSet = new Set(args.held_tickers);
  const watchSet = new Set(args.watchlist_tickers);
  const interest = new Set([...heldSet, ...watchSet]);

  const legsByTicker = new Map<string, typeof args.open_option_legs>();
  for (const leg of args.open_option_legs) {
    if (!legsByTicker.has(leg.ticker)) legsByTicker.set(leg.ticker, []);
    legsByTicker.get(leg.ticker)!.push(leg);
  }

  const rows: CalendarRow[] = [];
  for (const e of args.earnings) {
    if (!interest.has(e.ticker)) continue;
    const days = daysBetween(args.as_of, e.earnings_date);
    if (days > args.lookahead_days) continue;
    if (days < 0) continue;

    const window = windowOf(days);
    const status: CalendarRow["status"] =
      heldSet.has(e.ticker) && watchSet.has(e.ticker) ? "BOTH" :
      heldSet.has(e.ticker) ? "HELD" : "WATCHLIST";

    const conflictingLegs = (legsByTicker.get(e.ticker) ?? []).map((l) => ({
      expiry: l.expiry,
      strike: l.strike,
      right: l.right,
      side: l.side,
      expires_within_earnings: daysBetween(args.as_of, l.expiry) >= days,
    }));

    const flags: string[] = [];
    if (window === "WITHIN_2D" && status !== "WATCHLIST") {
      flags.push("R1: held position into earnings — review CC/CSP positioning");
    }
    if (e.iv_tier === "RED" && (window === "WITHIN_7D" || window === "WITHIN_2D")) {
      flags.push("RED-tier IV crush history — DO NOT sell earnings IV here");
    }
    if (e.iv_tier === "GREEN" && window === "WITHIN_14D") {
      flags.push("GREEN-tier IV crush history — premium-rich earnings IV-harvest candidate");
    }
    const shortLegsThruEarn = conflictingLegs.filter((l) => l.side === "SHORT" && l.expires_within_earnings);
    if (shortLegsThruEarn.length > 0 && window !== "OUTSIDE") {
      flags.push(`${shortLegsThruEarn.length} SHORT leg(s) expiring after earnings — assignment risk if pin`);
    }

    rows.push({
      ticker: e.ticker,
      earnings_date: e.earnings_date,
      days_until: days,
      timing: e.timing,
      iv_tier: e.iv_tier,
      expected_move_pct: e.expected_move_pct ?? null,
      consensus_eps: e.consensus_eps ?? null,
      status,
      earnings_window: window,
      conflicting_legs: conflictingLegs,
      flags,
    });
  }

  rows.sort((a, b) => a.days_until - b.days_until);

  const summary = {
    held_into_earnings_count: rows.filter((r) => (r.status === "HELD" || r.status === "BOTH") && r.earnings_window !== "OUTSIDE").length,
    red_tier_in_window: rows.filter((r) => r.iv_tier === "RED" && r.earnings_window !== "OUTSIDE").length,
    green_tier_in_window: rows.filter((r) => r.iv_tier === "GREEN" && r.earnings_window !== "OUTSIDE").length,
    next_7_days: rows.filter((r) => r.days_until <= 7).length,
  };

  return {
    as_of: args.as_of,
    lookahead_days: args.lookahead_days,
    rows,
    summary,
    earnings_within_days_map: Object.fromEntries(rows.map((r) => [r.ticker, r.days_until])),
    iv_tier_map: Object.fromEntries(rows.filter((r) => r.iv_tier !== "UNKNOWN").map((r) => [r.ticker, r.iv_tier])),
  };
}
