import { describe, expect, it } from "vitest";
import { classifyTradeOutcomeHandler } from "../../src/tools/classify-trade-outcome.js";

describe("classifyTradeOutcomeHandler", () => {
  it("classifies CC expired worthless as WIN_EXPIRED w/ theta-decay edge", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [{
        ticker: "AAPL", structure: "covered_call",
        entry_date: "2026-04-01", exit_date: "2026-04-19",
        entry_credit_or_debit: 1.50, realized_pnl_usd: 150,
        exit_reason: "expired_worthless",
      }],
    });
    expect(r.classified[0]!.outcome).toBe("WIN_EXPIRED");
    expect(r.classified[0]!.edge_attribution.some((e) => e.includes("theta"))).toBe(true);
    expect(r.classified[0]!.hold_days).toBe(18);
  });

  it("classifies managed-at-50pct close as WIN_MANAGED", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [{
        ticker: "NVDA", structure: "put_credit_spread",
        entry_date: "2026-04-01", exit_date: "2026-04-12",
        entry_credit_or_debit: 1.00, realized_pnl_usd: 60,
        exit_reason: "closed_at_target",
        managed_at_pct_of_max: 0.6,
      }],
    });
    expect(r.classified[0]!.outcome).toBe("WIN_MANAGED");
    expect(r.classified[0]!.edge_attribution.some((e) => e.includes("60% of max"))).toBe(true);
  });

  it("classifies assignment as LOSS_ASSIGNED", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [{
        ticker: "BBAI", structure: "cash_secured_put",
        entry_date: "2026-04-10", exit_date: "2026-04-24",
        entry_credit_or_debit: 0.30, realized_pnl_usd: -120,
        exit_reason: "assigned",
      }],
    });
    expect(r.classified[0]!.outcome).toBe("LOSS_ASSIGNED");
    expect(r.classified[0]!.edge_attribution.some((e) => e.includes("assignment risk"))).toBe(true);
  });

  it("classifies stopped trade as LOSS_STOPPED", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [{
        ticker: "TSLA", structure: "long_stock",
        entry_date: "2026-03-15", exit_date: "2026-04-01",
        entry_credit_or_debit: -200, realized_pnl_usd: -250,
        exit_reason: "stop_loss_hit",
      }],
    });
    expect(r.classified[0]!.outcome).toBe("LOSS_STOPPED");
  });

  it("classifies rolled-at-loss as LOSS_ROLLED w/ revenge-roll warning", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [{
        ticker: "AG", structure: "calendar_roll",
        entry_date: "2026-04-01", exit_date: "2026-04-15",
        entry_credit_or_debit: 0.10, realized_pnl_usd: -50,
        exit_reason: "rolled",
      }],
    });
    expect(r.classified[0]!.outcome).toBe("LOSS_ROLLED");
    expect(r.classified[0]!.edge_attribution.some((e) => e.includes("revenge-roll"))).toBe(true);
  });

  it("classifies breakeven (|pnl|<$1)", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [{
        ticker: "X", structure: "covered_call",
        entry_date: "2026-04-01", exit_date: "2026-04-10",
        entry_credit_or_debit: 1.00, realized_pnl_usd: 0.5,
      }],
    });
    expect(r.classified[0]!.outcome).toBe("BREAKEVEN");
  });

  it("computes summary aggregates correctly", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [
        { ticker: "A", structure: "covered_call", entry_date: "2026-04-01", exit_date: "2026-04-19",
          entry_credit_or_debit: 1.0, realized_pnl_usd: 100, exit_reason: "expired_worthless" },
        { ticker: "B", structure: "covered_call", entry_date: "2026-04-01", exit_date: "2026-04-19",
          entry_credit_or_debit: 1.0, realized_pnl_usd: 100, exit_reason: "expired_worthless" },
        { ticker: "C", structure: "long_stock", entry_date: "2026-04-01", exit_date: "2026-04-19",
          entry_credit_or_debit: -200, realized_pnl_usd: -50, exit_reason: "stop_loss_hit" },
      ],
    });
    expect(r.summary.total_trades).toBe(3);
    expect(r.summary.total_realized_pnl_usd).toBe(150);
    expect(r.summary.win_rate).toBeCloseTo(0.67, 1);
    expect(r.summary.buckets.WIN_EXPIRED).toBe(2);
    expect(r.summary.buckets.LOSS_STOPPED).toBe(1);
  });

  it("preserves thesis_ref + confluence_tier in edge attribution", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [{
        ticker: "AG", structure: "covered_call",
        entry_date: "2026-04-01", exit_date: "2026-04-19",
        entry_credit_or_debit: 1.0, realized_pnl_usd: 100,
        exit_reason: "expired_worthless",
        thesis_ref: "silver-inflation-hedge",
        confluence_tier_at_entry: "TIER-1",
      }],
    });
    expect(r.classified[0]!.thesis_ref).toBe("silver-inflation-hedge");
    expect(r.classified[0]!.confluence_tier_at_entry).toBe("TIER-1");
    expect(r.classified[0]!.edge_attribution.some((e) => e.includes("TIER-1"))).toBe(true);
    expect(r.classified[0]!.edge_attribution.some((e) => e.includes("silver"))).toBe(true);
  });

  it("flags missing exit_reason in notes", async () => {
    const r = await classifyTradeOutcomeHandler({
      trades: [{
        ticker: "X", structure: "covered_call",
        entry_date: "2026-04-01", exit_date: "2026-04-19",
        entry_credit_or_debit: 1.0, realized_pnl_usd: 100,
      }],
    });
    expect(r.classified[0]!.notes.some((n) => n.includes("exit_reason missing"))).toBe(true);
  });
});
