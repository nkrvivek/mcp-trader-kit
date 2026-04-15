import { z } from "zod";
import { composeCheckTrade } from "../gates/compose.js";
import type { Profile } from "../profiles/schema.js";
import type { SnaptradeReadClient } from "../mcp/snaptrade-read-client.js";

export const CheckTradeArgs = z.object({
  profile: z.string().min(1),
  tool: z.string().min(1),
  ticker: z.string().min(1).max(20),
  direction: z.enum(["BUY", "SELL", "BUY_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_OPEN", "SELL_TO_CLOSE"]),
  qty: z.number().positive(),
  notional_usd: z.number().nonnegative(),
  leg_shape: z.string().optional(),
  portfolio_total_usd: z.number().nonnegative().default(0),
  existing_ticker_exposure_usd: z.number().nonnegative().default(0),
  require_wash_sale_check: z.boolean().default(false),
});

export interface CheckTradeDeps {
  allProfiles: Profile[];
  snaptradeRead: SnaptradeReadClient | null;
}

export async function checkTradeHandler(
  raw: unknown,
  deps: CheckTradeDeps
): Promise<{ pass: boolean; reasons: string[]; warnings: string[] }> {
  const args = CheckTradeArgs.parse(raw);
  const profile = deps.allProfiles.find((p) => p.name === args.profile);
  if (!profile) {
    return { pass: false, reasons: [`unknown profile: ${args.profile}`], warnings: [] };
  }

  const tradeBase = {
    tool: args.tool,
    ticker: args.ticker,
    direction: args.direction,
    qty: args.qty,
    notional_usd: args.notional_usd,
    portfolio_total_usd: args.portfolio_total_usd,
    existing_ticker_exposure_usd: args.existing_ticker_exposure_usd,
  };
  const trade = args.leg_shape !== undefined
    ? { ...tradeBase, leg_shape: args.leg_shape }
    : tradeBase;

  return composeCheckTrade({
    profile,
    allProfiles: deps.allProfiles,
    trade,
    fetchActivities: async (accounts, since) => {
      if (!deps.snaptradeRead) throw new Error("snaptrade-read not configured");
      return deps.snaptradeRead.getActivities(accounts, since);
    },
    requireWashSaleCheck: args.require_wash_sale_check,
  });
}
