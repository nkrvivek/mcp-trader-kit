import { z } from "zod";
import type { Profile } from "../profiles/schema.js";

export const ProposeTradeArgs = z.object({
  profile: z.string().min(1),
  ticker: z.string().min(1).max(20),
  direction: z.enum(["BUY", "SELL", "BUY_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_OPEN", "SELL_TO_CLOSE"]),
  current_price: z.number().positive(),
  portfolio_total_usd: z.number().positive(),
  existing_ticker_exposure_usd: z.number().nonnegative().default(0),
  regime_tier: z.enum(["CLEAR", "CAUTION", "DEFENSIVE", "HALT"]).default("CLEAR"),
  structure: z.string().optional(),
  thesis_ref: z.string().optional(),
  signal_summary: z.string().optional(),
});

const SIZE_MULTIPLIERS: Record<string, number> = {
  CLEAR: 1.0, CAUTION: 0.75, DEFENSIVE: 0.5, HALT: 0.25,
};

const BLOCKED_DIRECTIONS: Record<string, string[]> = {
  CLEAR: [],
  CAUTION: [],
  DEFENSIVE: ["BUY", "BUY_TO_OPEN"],
  HALT: ["BUY", "BUY_TO_OPEN", "SELL_TO_OPEN"],
};

function concentrationLabel(pct: number, cap: number): string {
  if (pct > cap) return "OVER-CAP";
  if (pct > cap * 0.9) return "NEAR-CAP";
  if (pct > cap * 0.75) return "AT-CAP";
  return "HEADROOM";
}

export async function proposeTradeHandler(
  raw: unknown,
  deps: { allProfiles: Profile[] }
) {
  const args = ProposeTradeArgs.parse(raw);
  const profile = deps.allProfiles.find((p) => p.name === args.profile);
  if (!profile) {
    return { status: "REJECTED", reason: `unknown profile: ${args.profile}` };
  }

  const cap = profile.caps.max_single_name_pct;
  const currentPct = (args.existing_ticker_exposure_usd / args.portfolio_total_usd) * 100;
  const headroomPct = Math.max(0, cap - currentPct);
  const headroomLabel = concentrationLabel(currentPct, cap);

  const blocked = BLOCKED_DIRECTIONS[args.regime_tier]!;
  if (blocked.includes(args.direction)) {
    return {
      status: "REJECTED",
      reason: `${args.direction} blocked in ${args.regime_tier} regime`,
      ticker: args.ticker,
      regime_tier: args.regime_tier,
      concentration: { current_pct: round(currentPct), cap_pct: cap, label: headroomLabel },
    };
  }

  if (headroomLabel === "OVER-CAP" && ["BUY", "BUY_TO_OPEN"].includes(args.direction)) {
    return {
      status: "REJECTED",
      reason: `${args.ticker} at ${round(currentPct)}% exceeds ${cap}% cap — no adds`,
      ticker: args.ticker,
      concentration: { current_pct: round(currentPct), cap_pct: cap, label: headroomLabel },
    };
  }

  const multiplier = SIZE_MULTIPLIERS[args.regime_tier]!;
  const rawSizeUsd = headroomPct * 0.5 * 0.01 * args.portfolio_total_usd;
  const cappedSizeUsd = Math.min(rawSizeUsd, profile.caps.max_order_notional);
  const adjustedSizeUsd = round(cappedSizeUsd * multiplier);
  const shares = Math.floor(adjustedSizeUsd / args.current_price);

  if (shares <= 0) {
    return {
      status: "REJECTED",
      reason: `computed size is 0 shares — headroom ${round(headroomPct)}% too small or price too high`,
      ticker: args.ticker,
      sizing_trace: `headroom=${round(headroomPct)}% × 0.5 × NAV × ${multiplier}x = $${adjustedSizeUsd}`,
    };
  }

  const postPct = round(((args.existing_ticker_exposure_usd + adjustedSizeUsd) / args.portfolio_total_usd) * 100);

  return {
    status: "CANDIDATE",
    ticker: args.ticker,
    direction: args.direction,
    structure: args.structure ?? "equity",
    shares,
    notional_usd: round(shares * args.current_price),
    sizing: {
      headroom_pct: round(headroomPct),
      raw_size_usd: round(rawSizeUsd),
      regime_multiplier: multiplier,
      adjusted_size_usd: adjustedSizeUsd,
      trace: `(${cap}% - ${round(currentPct)}%) × 0.5 × $${args.portfolio_total_usd.toLocaleString()} × ${multiplier}x = $${adjustedSizeUsd.toLocaleString()}`,
    },
    concentration: {
      current_pct: round(currentPct),
      post_trade_pct: postPct,
      cap_pct: cap,
      label: headroomLabel,
    },
    regime_tier: args.regime_tier,
    thesis_ref: args.thesis_ref ?? null,
    signal_summary: args.signal_summary ?? null,
    cap_check: adjustedSizeUsd <= profile.caps.max_order_notional ? "PASS" : "CAPPED",
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
