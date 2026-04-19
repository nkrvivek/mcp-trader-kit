import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportTradesHandler } from "../../src/tools/report-trades.js";

describe("reportTradesHandler", () => {
  let tmp: string;
  const originalHome = process.env.TRADERKIT_HOME;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "traderkit-report-"));
    process.env.TRADERKIT_HOME = tmp;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.TRADERKIT_HOME;
    else process.env.TRADERKIT_HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty message when no sessions", async () => {
    const r: any = await reportTradesHandler({});
    expect(r.sessions_found).toBe(0);
    expect(r.message).toMatch(/No sessions/);
  });

  it("aggregates executed trades from session JSON files", async () => {
    const dayDir = join(tmp, "sessions", "2026-04-19");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, "personal-interactive-093000.json"),
      JSON.stringify({
        session_id: "2026-04-19-personal-interactive-093000",
        profile: "personal",
        mode: "interactive",
        date: "2026-04-19",
        regime_tier: "CAUTION",
        executed: [
          { ticker: "AAPL", structure: "covered_call", premium_usd: 180, realized_pnl_usd: 180 },
          { ticker: "SLV", structure: "cash_secured_put", premium_usd: 250, realized_pnl_usd: -50 },
        ],
      })
    );
    writeFileSync(
      join(dayDir, "personal-dry-run-101500.json"),
      JSON.stringify({
        session_id: "2026-04-19-personal-dry-run-101500",
        profile: "personal",
        mode: "dry-run",
        date: "2026-04-19",
        regime_tier: "CAUTION",
        executed: [{ ticker: "TSLA", structure: "long_stock", realized_pnl_usd: 500 }],
      })
    );

    const r: any = await reportTradesHandler({ since_days: 7 });
    expect(r.sessions_found).toBe(1); // dry-run excluded by default
    expect(r.trades_executed).toBe(2);
    expect(r.premium_collected_usd).toBe(430);
    expect(r.realized_pnl_usd).toBe(130);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(1);
    expect(r.win_rate).toBe(0.5);
    expect(r.by_structure.covered_call.count).toBe(1);
    expect(r.by_structure.cash_secured_put.count).toBe(1);
    expect(r.by_regime.CAUTION.sessions).toBe(1);
  });

  it("includes dry-run when include_dry_run=true", async () => {
    const dayDir = join(tmp, "sessions", "2026-04-19");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, "personal-dry-run-101500.json"),
      JSON.stringify({
        session_id: "x",
        profile: "personal",
        mode: "dry-run",
        date: "2026-04-19",
        executed: [{ ticker: "TSLA", realized_pnl_usd: 500 }],
      })
    );

    const r: any = await reportTradesHandler({ include_dry_run: true });
    expect(r.sessions_found).toBe(1);
    expect(r.trades_executed).toBe(1);
  });

  it("filters by profile", async () => {
    const dayDir = join(tmp, "sessions", "2026-04-19");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, "personal-interactive-093000.json"),
      JSON.stringify({ session_id: "a", profile: "personal", mode: "interactive", date: "2026-04-19", executed: [{ ticker: "AAPL" }] })
    );
    writeFileSync(
      join(dayDir, "bildof-interactive-101500.json"),
      JSON.stringify({ session_id: "b", profile: "bildof", mode: "interactive", date: "2026-04-19", executed: [{ ticker: "SPY" }] })
    );

    const r: any = await reportTradesHandler({ profile: "bildof" });
    expect(r.sessions_found).toBe(1);
    expect(r.trades_executed).toBe(1);
  });
});
