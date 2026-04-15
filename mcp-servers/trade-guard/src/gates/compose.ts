import type { Profile } from "../profiles/schema.js";
import type { Activity } from "../mcp/snaptrade-read-client.js";
import { checkCaps, type TradeProposal, type GateResult } from "./caps.js";
import { checkWashSale } from "./wash-sale.js";

export interface ComposeInput {
  profile: Profile;
  allProfiles: Profile[];
  trade: TradeProposal;
  fetchActivities: (accountIds: string[], since: Date) => Promise<Activity[]>;
  requireWashSaleCheck?: boolean;
  now?: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function composeCheckTrade(input: ComposeInput): Promise<GateResult> {
  const caps = checkCaps(input.profile, input.trade);
  const reasons = [...caps.reasons];
  const warnings = [...caps.warnings];

  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);
  const poolAccounts = input.allProfiles
    .filter((p) => p.tax_entity === input.profile.tax_entity)
    .map((p) => p.account_id);

  let activities: Activity[] = [];
  try {
    activities = await input.fetchActivities(poolAccounts, since);
  } catch (e) {
    const msg = `wash-sale check unavailable: ${(e as Error).message}`;
    if (input.requireWashSaleCheck) reasons.push(`wash-sale check required but ${msg}`);
    else warnings.push(msg);
    return { pass: reasons.length === 0, reasons, warnings };
  }

  const sellAtLoss = input.trade.direction.startsWith("SELL") &&
    input.trade.notional_usd < input.trade.existing_ticker_exposure_usd;

  const ws = checkWashSale({
    action: input.trade.direction.startsWith("BUY") ? "BUY" : "SELL",
    ticker: input.trade.ticker,
    tradeDate: now,
    activeProfile: input.profile,
    allProfiles: input.allProfiles,
    activities,
    sellAtLoss,
  });
  if (ws.flagged) reasons.push(`wash-sale: ${ws.detail}`);

  return { pass: reasons.length === 0, reasons, warnings };
}
