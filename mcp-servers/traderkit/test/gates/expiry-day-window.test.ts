import { describe, expect, it } from "vitest";
import { checkExpiryDayWindow } from "../../src/gates/expiry-day-window.js";
import { type Profile, DEFAULT_RULES, PERMISSIVE_RULES } from "../../src/profiles/schema.js";

const BASE: Profile = {
  name: "bildof", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "llc-bildof",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: [] },
  rules: DEFAULT_RULES,
};

describe("checkExpiryDayWindow R1", () => {
  it("blocks SELL_TO_OPEN at 14:07Z on expiry day", () => {
    const r = checkExpiryDayWindow({
      profile: BASE,
      now: new Date("2026-04-17T14:07:00Z"),
      expiry_date: "2026-04-17",
      direction: "SELL_TO_OPEN",
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/R1: no new short legs on expiry day/);
  });

  it("allows SELL_TO_OPEN at 14:31Z (just after window)", () => {
    const r = checkExpiryDayWindow({
      profile: BASE,
      now: new Date("2026-04-17T14:31:00Z"),
      expiry_date: "2026-04-17",
      direction: "SELL_TO_OPEN",
    });
    expect(r.pass).toBe(true);
  });

  it("allows BUY_TO_CLOSE in window", () => {
    const r = checkExpiryDayWindow({
      profile: BASE,
      now: new Date("2026-04-17T14:00:00Z"),
      expiry_date: "2026-04-17",
      direction: "BUY_TO_CLOSE",
    });
    expect(r.pass).toBe(true);
  });

  it("allows SELL_TO_OPEN on non-expiry day", () => {
    const r = checkExpiryDayWindow({
      profile: BASE,
      now: new Date("2026-04-14T14:00:00Z"),
      expiry_date: "2026-04-17",
      direction: "SELL_TO_OPEN",
    });
    expect(r.pass).toBe(true);
  });

  it("skips when R1 toggle off", () => {
    const p = { ...BASE, rules: PERMISSIVE_RULES };
    const r = checkExpiryDayWindow({
      profile: p,
      now: new Date("2026-04-17T14:07:00Z"),
      expiry_date: "2026-04-17",
      direction: "SELL_TO_OPEN",
    });
    expect(r.pass).toBe(true);
  });

  it("strict_mode requires expiry_date", () => {
    const r = checkExpiryDayWindow({
      profile: BASE,
      now: new Date("2026-04-17T14:07:00Z"),
      direction: "SELL_TO_OPEN",
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/expiry_date required/);
  });
});
