import type { Profile } from "../profiles/schema.js";
import type { Activity } from "../mcp/snaptrade-read-client.js";
import { THIRTY_DAYS_MS } from "../utils/date.js";

const WINDOW_MS = THIRTY_DAYS_MS;

export interface WashSaleContext {
  action: "BUY" | "SELL";
  ticker: string;
  tradeDate: Date;
  activeProfile: Profile;
  allProfiles: Profile[];
  activities: Activity[];
  sellAtLoss?: boolean;
}

export interface WashSaleResult {
  flagged: boolean;
  detail: string;
  windowStart: string;
  windowEnd: string;
}

function entityAccounts(profile: Profile, all: Profile[]): Set<string> {
  return new Set(all.filter((p) => p.tax_entity === profile.tax_entity).map((p) => p.account_id));
}

function profileByAccount(accountId: string, all: Profile[]): Profile | undefined {
  return all.find((p) => p.account_id === accountId);
}

function matchesTicker(act: Activity, ticker: string): boolean {
  if (act.symbol === ticker) return true;
  if (act.underlying_symbol === ticker) return true;
  return false;
}

export function checkWashSale(ctx: WashSaleContext): WashSaleResult {
  const accounts = entityAccounts(ctx.activeProfile, ctx.allProfiles);
  const windowStartMs = ctx.tradeDate.getTime() - WINDOW_MS;
  const windowEndMs = ctx.tradeDate.getTime() + WINDOW_MS;

  const inPool = ctx.activities.filter(
    (a) => accounts.has(a.account_id) && matchesTicker(a, ctx.ticker)
  );
  const inWindow = inPool.filter((a) => {
    const t = new Date(a.trade_date + "T00:00:00Z").getTime();
    return t >= windowStartMs && t <= windowEndMs;
  });

  if (ctx.action === "BUY") {
    const priorLoss = inWindow.find((a) => a.action === "SELL" && (a.realized_pnl ?? 0) < 0);
    if (priorLoss) {
      const p = profileByAccount(priorLoss.account_id, ctx.allProfiles);
      return {
        flagged: true,
        detail: `BUY ${ctx.ticker} would disallow $${Math.abs(priorLoss.realized_pnl ?? 0)} loss from SELL on ${priorLoss.trade_date} in ${p?.name ?? priorLoss.account_id}`,
        windowStart: new Date(windowStartMs).toISOString().slice(0, 10),
        windowEnd: new Date(windowEndMs).toISOString().slice(0, 10),
      };
    }
  } else if (ctx.action === "SELL" && ctx.sellAtLoss === true) {
    const recentBuy = inWindow.find((a) => a.action === "BUY");
    if (recentBuy) {
      const p = profileByAccount(recentBuy.account_id, ctx.allProfiles);
      return {
        flagged: true,
        detail: `SELL at loss of ${ctx.ticker} would be wash by BUY on ${recentBuy.trade_date} in ${p?.name ?? recentBuy.account_id}`,
        windowStart: new Date(windowStartMs).toISOString().slice(0, 10),
        windowEnd: new Date(windowEndMs).toISOString().slice(0, 10),
      };
    }
  }

  return {
    flagged: false,
    detail: "clean",
    windowStart: new Date(windowStartMs).toISOString().slice(0, 10),
    windowEnd: new Date(windowEndMs).toISOString().slice(0, 10),
  };
}
