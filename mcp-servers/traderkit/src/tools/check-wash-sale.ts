import { z } from "zod";
import { checkWashSale } from "../gates/wash-sale.js";
import type { Profile } from "../profiles/schema.js";
import type { SnaptradeReadClient } from "../mcp/snaptrade-read-client.js";
import { TickerSchema } from "../utils/schemas.js";
import { THIRTY_DAYS_MS } from "../utils/date.js";

export const CheckWashSaleArgs = z.object({
  ticker: TickerSchema,
  action: z.enum(["BUY", "SELL"]),
  tax_entity: z.string().min(1),
  sell_at_loss: z.boolean().default(false),
});

export async function checkWashSaleHandler(
  raw: unknown,
  deps: { allProfiles: Profile[]; snaptradeRead: SnaptradeReadClient | null }
) {
  const args = CheckWashSaleArgs.parse(raw);
  const pool = deps.allProfiles.filter((p) => p.tax_entity === args.tax_entity);
  if (pool.length === 0) return { flagged: false, detail: `no profiles in ${args.tax_entity}`, windowStart: "", windowEnd: "" };

  const now = new Date();
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);
  if (!deps.snaptradeRead) return { flagged: false, detail: "snaptrade-read unavailable — check skipped", windowStart: "", windowEnd: "" };
  const activities = await deps.snaptradeRead.getActivities(pool.map((p) => p.account_id), since);
  return checkWashSale({
    action: args.action, ticker: args.ticker, tradeDate: now,
    activeProfile: pool[0]!, allProfiles: deps.allProfiles, activities,
    sellAtLoss: args.sell_at_loss,
  });
}
