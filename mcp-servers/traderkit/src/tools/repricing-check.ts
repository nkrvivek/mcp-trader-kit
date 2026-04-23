import { z } from "zod";

const BagLegSchema = z.object({
  action: z.enum(["BUY", "SELL"]),
  right: z.enum(["C", "P"]),
  strike: z.number().positive(),
  expiry: z.string(),
  ratio: z.number().int().positive().default(1),
});

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
  legs: z.array(BagLegSchema).optional(),
  near_leg_dte: z.number().int().nonnegative().optional(),
  near_leg_oi: z.number().int().nonnegative().optional(),
  underlying_adv_30d: z.number().positive().optional(),
  minutes_to_close: z.number().nonnegative().optional(),
});

export type RepricingCheckResult = {
  action: "HOLD" | "REPRICE" | "CANCEL" | "LEG_OUT";
  reasons: string[];
  age_minutes: number;
  underlying_move_pct: number;
  adverse: boolean;
  fill_pct: number;
  recommendation: string;
  bag_fillability?: "HIGH" | "MEDIUM" | "LOW" | undefined;
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

  let bagFillability: RepricingCheckResult["bag_fillability"];
  if (args.legs && args.legs.length >= 2) {
    let score = 100;
    const bagReasons: string[] = [];
    if (args.near_leg_dte !== undefined && args.near_leg_dte <= 1) {
      score -= 25;
      bagReasons.push(`near-leg DTE ${args.near_leg_dte} ≤ 1`);
    }
    if (args.near_leg_oi !== undefined && args.near_leg_oi < 2000) {
      score -= 20;
      bagReasons.push(`near-leg OI ${args.near_leg_oi} < 2,000`);
    }
    if (args.underlying_adv_30d !== undefined && args.underlying_adv_30d < 5_000_000) {
      score -= 15;
      bagReasons.push(`ADV ${args.underlying_adv_30d.toLocaleString()} < 5M`);
    }
    if (args.minutes_to_close !== undefined && args.minutes_to_close < 60) {
      score -= 15;
      bagReasons.push(`${args.minutes_to_close} min to close < 60`);
    }
    bagFillability = score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";

    if (bagFillability === "LOW") {
      action = args.limit_price <= 0 && (args.minutes_to_close ?? 99) < 30 ? "CANCEL" : "LEG_OUT";
      rec = action === "CANCEL"
        ? `R14: BAG net ≤ 0 w/ <30min to close — cancel & accept expiration/assignment`
        : `R14: BAG fillability LOW — cancel combo + leg out (BTC near @ ask, STO far @ bid) as two single-leg orders`;
      for (const r of bagReasons) reasons.push(r);
    }
  }

  return {
    action,
    reasons,
    age_minutes: ageMin,
    underlying_move_pct: movePct,
    adverse,
    fill_pct: fillPct,
    recommendation: rec,
    bag_fillability: bagFillability,
  };
}
