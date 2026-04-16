import { z } from "zod";
import { scanTlh, type Position } from "./scan-tlh.js";
import type { Profile } from "../profiles/schema.js";
import type { SnaptradeReadClient } from "../mcp/snaptrade-read-client.js";
import { TickerSchema } from "../utils/schemas.js";
import { THIRTY_DAYS_MS } from "../utils/date.js";
import { toMessage } from "../utils/errors.js";

export const ScanTlhArgs = z.object({
  tax_entity: z.string().min(1),
  threshold_usd: z.number().nonnegative().default(500),
  positions: z.array(z.object({
    ticker: TickerSchema,
    qty: z.number().positive(),
    cost_basis_per_unit: z.number().nonnegative(),
    current_price: z.number().nonnegative(),
    account_id: z.string().min(1),
  })),
});

export async function scanTlhHandler(
  raw: unknown,
  deps: { allProfiles: Profile[]; snaptradeRead: SnaptradeReadClient | null }
) {
  const args = ScanTlhArgs.parse(raw);
  const pool = deps.allProfiles.filter((p) => p.tax_entity === args.tax_entity);
  if (pool.length === 0) {
    return { candidates: [], detail: `no profiles in tax_entity ${args.tax_entity}` };
  }

  const now = new Date();
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);

  let activities: Awaited<ReturnType<SnaptradeReadClient["getActivities"]>> = [];
  let activityWarning: string | undefined;
  if (deps.snaptradeRead) {
    try {
      activities = await deps.snaptradeRead.getActivities(pool.map((p) => p.account_id), since);
    } catch (e) {
      process.stderr.write(`traderkit: scan_tlh activities fetch failed: ${toMessage(e)}\n`);
      activityWarning = "snaptrade-read unavailable — wash-sale filter skipped, candidates may not be clean";
    }
  } else {
    activityWarning = "snaptrade-read not configured — wash-sale filter skipped";
  }

  const candidates = await scanTlh({
    taxEntity: args.tax_entity,
    thresholdUsd: args.threshold_usd,
    profiles: deps.allProfiles,
    positions: args.positions as Position[],
    activities,
    now,
  });

  return {
    candidates: candidates.map((c) => ({
      ticker: c.ticker,
      unrealized_loss_usd: c.unrealized_loss_usd,
      qty: c.qty,
      account: c.account,
      wash_sale_clean: c.wash_sale_clean,
    })),
    ...(activityWarning ? { warning: activityWarning } : {}),
  };
}
