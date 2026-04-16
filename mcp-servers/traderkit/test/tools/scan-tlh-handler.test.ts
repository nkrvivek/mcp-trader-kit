import { describe, expect, it } from "vitest";
import { scanTlhHandler } from "../../src/tools/scan-tlh-handler.js";
import type { Profile } from "../../src/profiles/schema.js";

const PERSONAL: Profile = {
  name: "personal", broker: "snaptrade",
  account_id: "22222222-2222-2222-2222-222222222222",
  tax_entity: "personal",
  caps: { max_order_notional: 50000, max_single_name_pct: 50, forbidden_tools: [], forbidden_leg_shapes: [] },
};

describe("scanTlhHandler", () => {
  it("returns candidates with unrealized loss above threshold", async () => {
    const r = await scanTlhHandler({
      tax_entity: "personal",
      threshold_usd: 500,
      positions: [
        { ticker: "AAPL", qty: 100, cost_basis_per_unit: 200, current_price: 180, account_id: PERSONAL.account_id },
        { ticker: "NVDA", qty: 50, cost_basis_per_unit: 100, current_price: 120, account_id: PERSONAL.account_id },
      ],
    }, { allProfiles: [PERSONAL], snaptradeRead: null });

    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.ticker).toBe("AAPL");
    expect(r.candidates[0]!.unrealized_loss_usd).toBe(2000);
    expect(r.warning).toContain("not configured");
  });

  it("returns empty for unknown tax_entity", async () => {
    const r = await scanTlhHandler({
      tax_entity: "llc-unknown",
      threshold_usd: 500,
      positions: [
        { ticker: "AAPL", qty: 100, cost_basis_per_unit: 200, current_price: 180, account_id: PERSONAL.account_id },
      ],
    }, { allProfiles: [PERSONAL], snaptradeRead: null });

    expect(r.candidates).toHaveLength(0);
    expect(r.detail).toContain("no profiles");
  });

  it("defaults threshold to 500", async () => {
    const r = await scanTlhHandler({
      tax_entity: "personal",
      positions: [
        { ticker: "MSFT", qty: 10, cost_basis_per_unit: 400, current_price: 395, account_id: PERSONAL.account_id },
      ],
    }, { allProfiles: [PERSONAL], snaptradeRead: null });

    expect(r.candidates).toHaveLength(0);
  });
});
