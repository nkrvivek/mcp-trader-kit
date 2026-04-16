import type { Profile } from "../profiles/schema.js";

export interface TradeProposal {
  tool: string;
  ticker: string;
  direction: "BUY" | "SELL" | "BUY_TO_OPEN" | "BUY_TO_CLOSE" | "SELL_TO_OPEN" | "SELL_TO_CLOSE";
  qty: number;
  notional_usd: number;
  leg_shape?: string;
  portfolio_total_usd: number;
  existing_ticker_exposure_usd: number;
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
  warnings: string[];
}

const fmt = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function checkCaps(profile: Profile, trade: TradeProposal): GateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (profile.caps.forbidden_tools.includes(trade.tool)) {
    reasons.push(`forbidden tool for profile ${profile.name}: ${trade.tool}`);
  }
  if (
    trade.leg_shape &&
    (profile.caps.forbidden_leg_shapes as readonly string[]).includes(trade.leg_shape)
  ) {
    reasons.push(`forbidden leg shape: ${trade.leg_shape}`);
  }
  if (trade.notional_usd > profile.caps.max_order_notional) {
    reasons.push(
      `notional ${fmt(trade.notional_usd)} > cap ${fmt(profile.caps.max_order_notional)}`
    );
  }
  if (trade.portfolio_total_usd > 0) {
    const post = trade.existing_ticker_exposure_usd + Math.max(0, trade.notional_usd);
    const pct = (post / trade.portfolio_total_usd) * 100;
    if (pct > profile.caps.max_single_name_pct) {
      reasons.push(
        `post-trade single-name ${trade.ticker} = ${pct.toFixed(1)}% > cap ${profile.caps.max_single_name_pct}%`
      );
    }
  } else {
    warnings.push("portfolio total missing — single-name concentration check skipped");
  }

  return { pass: reasons.length === 0, reasons, warnings };
}
