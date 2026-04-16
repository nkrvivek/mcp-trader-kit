import { describe, expect, it } from "vitest";
import { scanTlh, type Position } from "../../src/tools/scan-tlh.js";
import type { Profile } from "../../src/profiles/schema.js";
import type { Activity } from "../../src/mcp/snaptrade-read-client.js";

const PERSONAL: Profile = {
  name: "personal", broker: "snaptrade",
  account_id: "22222222-2222-2222-2222-222222222222",
  tax_entity: "personal",
  caps: { max_order_notional: 50000, max_single_name_pct: 50, forbidden_tools: [], forbidden_leg_shapes: [] },
};

const positions: Position[] = [
  { ticker: "AAPL", qty: 100, cost_basis_per_unit: 200, current_price: 180, account_id: PERSONAL.account_id },
  { ticker: "NVDA", qty: 50,  cost_basis_per_unit: 100, current_price: 120, account_id: PERSONAL.account_id },
  { ticker: "MSFT", qty: 20,  cost_basis_per_unit: 400, current_price: 395, account_id: PERSONAL.account_id },
];

describe("scanTlh", () => {
  it("returns only positions with unrealized loss > threshold, wash-sale-clean", async () => {
    const r = await scanTlh({
      taxEntity: "personal",
      thresholdUsd: 500,
      profiles: [PERSONAL],
      positions,
      activities: [],
      now: new Date("2026-04-14T12:00:00Z"),
    });
    expect(r.map((c) => c.ticker)).toEqual(["AAPL"]);
    expect(r[0]!.unrealized_loss_usd).toBe(2000);
  });

  it("excludes candidates with recent buy (wash-sale window)", async () => {
    const buy: Activity = {
      symbol: "AAPL", action: "BUY", quantity: 10, price: 180,
      trade_date: "2026-04-10", account_id: PERSONAL.account_id,
    };
    const r = await scanTlh({
      taxEntity: "personal", thresholdUsd: 500,
      profiles: [PERSONAL], positions, activities: [buy],
      now: new Date("2026-04-14T12:00:00Z"),
    });
    expect(r.map((c) => c.ticker)).toEqual([]);
  });

  it("scopes to tax_entity", async () => {
    const bildof: Profile = { ...PERSONAL, name: "bildof", tax_entity: "llc-bildof",
      account_id: "11111111-1111-1111-1111-111111111111" };
    const r = await scanTlh({
      taxEntity: "llc-bildof", thresholdUsd: 500,
      profiles: [PERSONAL, bildof], positions, activities: [],
      now: new Date("2026-04-14T12:00:00Z"),
    });
    expect(r).toEqual([]);
  });
});
