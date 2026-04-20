import { z } from "zod";

export const RepricingCheckArgs = z.object({
  order_id: z.string().optional(),
  ticker: z.string().min(1),
  direction: z.enum(["SELL_TO_OPEN", "BUY_TO_OPEN", "SELL_TO_CLOSE", "BUY_TO_CLOSE"]),
  limit_price: z.number().nonnegative(),
  submitted_at: z.string(),
  now: z.string().optional(),
  underlying_price_at_submit: z.number().positive(),
  underlying_price_now: z.number().positive(),
  stale_minutes: z.number().positive().default(30),
  adverse_move_pct: z.number().positive().default(2),
  filled_qty: z.number().int().nonnegative().default(0),
  intended_qty: z.number().int().positive(),
});

export type RepricingCheckResult = {
  action: "HOLD" | "REPRICE" | "CANCEL";
  reasons: string[];
  age_minutes: number;
  underlying_move_pct: number;
  adverse: boolean;
  fill_pct: number;
  recommendation: string;
};

export async function repricingCheckHandler(raw: unknown): Promise<RepricingCheckResult> {
  const args = RepricingCheckArgs.parse(raw);
  const now = args.now ? new Date(args.now) : new Date();
  const submitted = new Date(args.submitted_at);
  const ageMin = Math.round(((now.getTime() - submitted.getTime()) / 60000) * 10) / 10;

  const movePct = Math.round(((args.underlying_price_now - args.underlying_price_at_submit) / args.underlying_price_at_submit) * 10000) / 100;
  const bullish = args.direction === "SELL_TO_OPEN" && /P$|put/i.test(args.ticker) ||
    args.direction === "SELL_TO_OPEN"; // short puts profit when stock up; short calls profit when stock down
  // Adverse definition by direction:
  // SELL_TO_OPEN put → stock down is adverse
  // SELL_TO_OPEN call → stock up is adverse
  // BUY_TO_OPEN → stock against long is adverse (info-only here; user passes direction)
  // We treat "adverse" as: abs move exceeds threshold; direction sign determined by direction string.
  // For simplicity: flag any move exceeding threshold; caller interprets.
  const absMove = Math.abs(movePct);
  const adverse = absMove >= args.adverse_move_pct;
  const fillPct = Math.round((args.filled_qty / args.intended_qty) * 1000) / 10;

  const reasons: string[] = [];
  const stale = ageMin >= args.stale_minutes;
  if (stale) reasons.push(`age ${ageMin}m >= ${args.stale_minutes}m stale threshold`);
  if (adverse) reasons.push(`underlying moved ${movePct}% (|${absMove}%| >= ${args.adverse_move_pct}%)`);
  if (fillPct < 100 && args.filled_qty > 0) reasons.push(`partial fill ${args.filled_qty}/${args.intended_qty} (${fillPct}%)`);

  let action: RepricingCheckResult["action"] = "HOLD";
  let rec = "within-window — keep order live";
  if (stale && adverse) {
    action = "REPRICE";
    rec = `R3: cancel & reprice at new mid — order ${ageMin}m old, underlying moved ${movePct}%`;
  } else if (stale && !adverse) {
    action = "HOLD";
    rec = "stale but no adverse move — consider touching limit closer to mid";
  } else if (!stale && adverse) {
    action = "HOLD";
    rec = "watch — adverse move within stale window; reprice if unfilled at T+30m";
  }

  void bullish;
  return {
    action,
    reasons,
    age_minutes: ageMin,
    underlying_move_pct: movePct,
    adverse,
    fill_pct: fillPct,
    recommendation: rec,
  };
}
