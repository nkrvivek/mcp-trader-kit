import { describe, expect, it } from "vitest";
import { checkStrikeGrid } from "../../src/gates/strike-grid.js";
import { type Profile, DEFAULT_RULES, PERMISSIVE_RULES } from "../../src/profiles/schema.js";

const BASE: Profile = {
  name: "bildof", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "llc-bildof",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: [] },
  rules: DEFAULT_RULES,
};

const NOW = new Date("2026-04-14T14:30:00Z");
const FRESH = "2026-04-14T14:29:30Z";
const STALE = "2026-04-14T14:20:00Z";

describe("checkStrikeGrid R2", () => {
  it("requires grid for short-open", () => {
    const r = checkStrikeGrid({
      profile: BASE, direction: "SELL_TO_OPEN", now: NOW,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/strike_grid required/);
  });

  it("passes when selected strike equals best theta-per-Δ", () => {
    const r = checkStrikeGrid({
      profile: BASE, direction: "SELL_TO_OPEN", now: NOW,
      grid_as_of: FRESH,
      strike_grid: [
        { strike: 3.0, premium: 0.10, delta: 0.10 },
        { strike: 3.5, premium: 0.25, delta: 0.18 },
        { strike: 4.0, premium: 0.50, delta: 0.35 },
      ],
      selected_strike: 3.5,
    });
    expect(r.pass).toBe(true);
  });

  it("rejects BBAI case: $3 @ $0.10 when $3.5 @ $0.25 has much better yield/Δ", () => {
    const r = checkStrikeGrid({
      profile: BASE, direction: "SELL_TO_OPEN", now: NOW,
      grid_as_of: FRESH,
      strike_grid: [
        { strike: 3.0, premium: 0.10, delta: 0.10 },
        { strike: 3.5, premium: 0.25, delta: 0.18 },
        { strike: 4.0, premium: 0.50, delta: 0.35 },
      ],
      selected_strike: 3.0,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/selected.*materially worse/);
  });

  it("rejects stale grid", () => {
    const r = checkStrikeGrid({
      profile: BASE, direction: "SELL_TO_OPEN", now: NOW,
      grid_as_of: STALE,
      strike_grid: [
        { strike: 3.0, premium: 0.10, delta: 0.10 },
        { strike: 3.5, premium: 0.25, delta: 0.18 },
        { strike: 4.0, premium: 0.50, delta: 0.35 },
      ],
      selected_strike: 3.5,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => /stale|old/.test(x))).toBe(true);
  });

  it("skips wheel-assignment leg", () => {
    const r = checkStrikeGrid({
      profile: BASE, direction: "SELL_TO_OPEN", now: NOW,
      is_wheel_assignment_leg: true,
    });
    expect(r.pass).toBe(true);
    expect(r.warnings[0]).toMatch(/wheel-assignment/);
  });

  it("skips when R2 toggle off", () => {
    const p = { ...BASE, rules: PERMISSIVE_RULES };
    const r = checkStrikeGrid({
      profile: p, direction: "SELL_TO_OPEN", now: NOW,
    });
    expect(r.pass).toBe(true);
  });

  it("skips for BUY_TO_CLOSE (not short-open)", () => {
    const r = checkStrikeGrid({
      profile: BASE, direction: "BUY_TO_CLOSE", now: NOW,
    });
    expect(r.pass).toBe(true);
  });
});
