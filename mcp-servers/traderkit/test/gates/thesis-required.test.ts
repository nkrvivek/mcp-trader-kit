import { describe, expect, it } from "vitest";
import { checkThesisRequired } from "../../src/gates/thesis-required.js";
import { type Profile, DEFAULT_RULES, PERMISSIVE_RULES } from "../../src/profiles/schema.js";

const BASE: Profile = {
  name: "p", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "personal",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: [] },
  rules: DEFAULT_RULES,
};

describe("checkThesisRequired R7", () => {
  it("rejects when thesis_ref missing", () => {
    const r = checkThesisRequired({ profile: BASE, ticker: "BBAI" });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/thesis_ref required/);
  });

  it("accepts discretionary_event w/ rationale", () => {
    const r = checkThesisRequired({
      profile: BASE, ticker: "CVX",
      discretionary_event: true,
      discretionary_rationale: "Iran strike headline; tactical 1-day hedge via CVX calls",
    });
    expect(r.pass).toBe(true);
  });

  it("rejects discretionary w/ too-short rationale", () => {
    const r = checkThesisRequired({
      profile: BASE, ticker: "CVX",
      discretionary_event: true,
      discretionary_rationale: "test",
    });
    expect(r.pass).toBe(false);
  });

  it("rejects when thesis not found", () => {
    const r = checkThesisRequired({
      profile: BASE, ticker: "BBAI", thesis_ref: "bbai-long",
      active_theses: [{ thesis_id: "silver", tickers: ["SLV"], status: "active" }],
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/not found in active_theses/);
  });

  it("rejects closed thesis", () => {
    const r = checkThesisRequired({
      profile: BASE, ticker: "BBAI", thesis_ref: "bbai-long",
      active_theses: [{ thesis_id: "bbai-long", tickers: ["BBAI"], status: "closed" }],
    });
    expect(r.pass).toBe(false);
  });

  it("accepts ticker in active thesis", () => {
    const r = checkThesisRequired({
      profile: BASE, ticker: "BBAI", thesis_ref: "bbai-long",
      active_theses: [{ thesis_id: "bbai-long", tickers: ["BBAI"], status: "active" }],
    });
    expect(r.pass).toBe(true);
  });

  it("rejects ticker not in thesis tickers", () => {
    const r = checkThesisRequired({
      profile: BASE, ticker: "AAPL", thesis_ref: "bbai-long",
      active_theses: [{ thesis_id: "bbai-long", tickers: ["BBAI"], status: "active" }],
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/AAPL not in thesis/);
  });

  it("skips when R7 toggle off", () => {
    const p = { ...BASE, rules: PERMISSIVE_RULES };
    const r = checkThesisRequired({ profile: p, ticker: "BBAI" });
    expect(r.pass).toBe(true);
  });
});
