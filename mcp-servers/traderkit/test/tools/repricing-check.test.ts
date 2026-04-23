import { describe, expect, it } from "vitest";
import { repricingCheckHandler } from "../../src/tools/repricing-check.js";

describe("repricingCheckHandler", () => {
  it("HOLD when fresh + no adverse move", async () => {
    const r = await repricingCheckHandler({
      ticker: "AAPL",
      direction: "SELL_TO_OPEN",
      limit_price: 2.0,
      submitted_at: "2026-04-23T19:00:00Z",
      now: "2026-04-23T19:10:00Z",
      underlying_price_at_submit: 180,
      underlying_price_now: 180.5,
      intended_qty: 5,
    });
    expect(r.action).toBe("HOLD");
  });

  it("REPRICE when stale + adverse move", async () => {
    const r = await repricingCheckHandler({
      ticker: "MSFT",
      direction: "SELL_TO_OPEN",
      limit_price: 1.5,
      submitted_at: "2026-04-23T17:00:00Z",
      now: "2026-04-23T19:00:00Z",
      underlying_price_at_submit: 400,
      underlying_price_now: 390, // −2.5%
      intended_qty: 3,
    });
    expect(r.action).toBe("REPRICE");
    expect(r.reasons.some((x) => x.includes("stale"))).toBe(true);
  });

  it("LEG_OUT when BAG + low fillability (BBAI T-15 scenario)", async () => {
    const r = await repricingCheckHandler({
      ticker: "BBAI",
      direction: "SELL_TO_OPEN",
      limit_price: 0.05,
      submitted_at: "2026-04-23T09:14:00Z",
      now: "2026-04-23T19:45:00Z",
      underlying_price_at_submit: 3.75,
      underlying_price_now: 3.72,
      intended_qty: 20,
      legs: [
        { action: "BUY",  right: "P", strike: 4, expiry: "2026-04-24" },
        { action: "SELL", right: "P", strike: 4, expiry: "2026-05-01" },
      ],
      near_leg_dte: 1,
      near_leg_oi: 1342,
      underlying_adv_30d: 3_800_000,
      minutes_to_close: 15,
    });
    expect(r.bag_fillability).toBe("LOW");
    expect(r.action).toBe("LEG_OUT");
    expect(r.recommendation).toContain("R14");
    expect(r.recommendation).toContain("leg out");
  });

  it("CANCEL when BAG LOW + net ≤ 0 + <30 min to close", async () => {
    const r = await repricingCheckHandler({
      ticker: "BBAI",
      direction: "SELL_TO_OPEN",
      limit_price: 0.0,
      submitted_at: "2026-04-23T09:14:00Z",
      now: "2026-04-23T19:55:00Z",
      underlying_price_at_submit: 3.75,
      underlying_price_now: 3.72,
      intended_qty: 20,
      legs: [
        { action: "BUY",  right: "P", strike: 4, expiry: "2026-04-24" },
        { action: "SELL", right: "P", strike: 4, expiry: "2026-05-01" },
      ],
      near_leg_dte: 1,
      near_leg_oi: 1342,
      underlying_adv_30d: 3_800_000,
      minutes_to_close: 5,
    });
    expect(r.bag_fillability).toBe("LOW");
    expect(r.action).toBe("CANCEL");
    expect(r.recommendation).toContain("accept expiration/assignment");
  });

  it("HIGH fillability → no LEG_OUT override", async () => {
    const r = await repricingCheckHandler({
      ticker: "SPX",
      direction: "SELL_TO_OPEN",
      limit_price: 12.0,
      submitted_at: "2026-04-23T18:55:00Z",
      now: "2026-04-23T19:00:00Z",
      underlying_price_at_submit: 5200,
      underlying_price_now: 5205,
      intended_qty: 1,
      legs: [
        { action: "BUY",  right: "P", strike: 5100, expiry: "2026-05-15" },
        { action: "SELL", right: "P", strike: 5100, expiry: "2026-06-19" },
      ],
      near_leg_dte: 22,
      near_leg_oi: 25_000,
      underlying_adv_30d: 2_500_000_000,
      minutes_to_close: 65,
    });
    expect(r.bag_fillability).toBe("HIGH");
    expect(r.action).toBe("HOLD");
  });
});
