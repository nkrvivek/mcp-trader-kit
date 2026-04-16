import type { Profile } from "../profiles/schema.js";
import type { Activity } from "../mcp/snaptrade-read-client.js";
import { checkWashSale } from "../gates/wash-sale.js";

export interface Position {
  ticker: string;
  qty: number;
  cost_basis_per_unit: number;
  current_price: number;
  account_id: string;
}

export interface TlhCandidate {
  ticker: string;
  unrealized_loss_usd: number;
  qty: number;
  account: string;
  wash_sale_clean: boolean;
}

export interface ScanInput {
  taxEntity: string;
  thresholdUsd: number;
  profiles: Profile[];
  positions: Position[];
  activities: Activity[];
  now: Date;
}

export async function scanTlh(input: ScanInput): Promise<TlhCandidate[]> {
  const inPool = input.profiles.filter((p) => p.tax_entity === input.taxEntity);
  if (inPool.length === 0) return [];
  const accountSet = new Set(inPool.map((p) => p.account_id));

  const candidates: TlhCandidate[] = [];
  for (const pos of input.positions) {
    if (!accountSet.has(pos.account_id)) continue;
    const unrealized = (pos.cost_basis_per_unit - pos.current_price) * pos.qty;
    if (unrealized < input.thresholdUsd) continue;

    const activeProfile = inPool.find((p) => p.account_id === pos.account_id)!;
    const ws = checkWashSale({
      action: "SELL", ticker: pos.ticker, tradeDate: input.now,
      activeProfile, allProfiles: input.profiles, activities: input.activities, sellAtLoss: true,
    });
    if (ws.flagged) continue;

    candidates.push({
      ticker: pos.ticker,
      unrealized_loss_usd: unrealized,
      qty: pos.qty,
      account: activeProfile.name,
      wash_sale_clean: true,
    });
  }
  candidates.sort((a, b) => b.unrealized_loss_usd - a.unrealized_loss_usd);
  return candidates;
}
