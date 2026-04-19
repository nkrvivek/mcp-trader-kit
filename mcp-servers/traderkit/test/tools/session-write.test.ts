import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionWriteHandler } from "../../src/tools/session-write.js";

describe("sessionWriteHandler", () => {
  it("formats executed trades as markdown table", async () => {
    const r: any = await sessionWriteHandler({
      action: "format_executed",
      executed: [
        { ticker: "AAPL", direction: "BUY", qty: 10, price: 185.5, broker: "fidelity", order_id: "ORD-123", thesis_ref: "aapl-cc" },
        { ticker: "SLV", direction: "BUY", qty: 100, price: 28.4, broker: "e-trade" },
      ],
    });
    expect(r.markdown).toContain("| AAPL |");
    expect(r.markdown).toContain("| SLV |");
    expect(r.markdown).toContain("ORD-123");
    expect(r.markdown).toContain("—"); // missing order_id
  });

  it("formats empty executed list", async () => {
    const r: any = await sessionWriteHandler({ action: "format_executed", executed: [] });
    expect(r.markdown).toContain("No trades executed");
  });

  it("formats deferred trades as bullet list", async () => {
    const r: any = await sessionWriteHandler({
      action: "format_deferred",
      deferred: [
        { ticker: "SPY", direction: "BUY", reason: "IBKR only", tag: "ibkr-tuesday" },
      ],
    });
    expect(r.markdown).toContain("**SPY**");
    expect(r.markdown).toContain("IBKR-TUESDAY ▷");
  });

  it("formats no-trade log", async () => {
    const r: any = await sessionWriteHandler({
      action: "format_no_trade",
      no_trades: [
        { ticker: "TSLA", reason: "regime HALT — no new longs" },
      ],
    });
    expect(r.markdown).toContain("**TSLA**");
    expect(r.markdown).toContain("regime HALT");
  });

  it("formats session index row", async () => {
    const r: any = await sessionWriteHandler({
      action: "format_session_index_row",
      date: "2026-04-16",
      book: "personal",
      session_id: "2026-04-16-personal-001",
      nav: 813000,
      regime_tier: "CAUTION",
      signal_count: 5,
      proposal_count: 3,
      executed_count: 2,
      deferred_count: 1,
      mode: "interactive",
      trigger: "pre-open",
    });
    expect(r.row).toContain("2026-04-16");
    expect(r.row).toContain("personal");
    expect(r.row).toContain("CAUTION");
  });

  it("requires fields for session index row", async () => {
    const r: any = await sessionWriteHandler({ action: "format_session_index_row" });
    expect(r.error).toMatch(/required/);
  });

  describe("action=save", () => {
    let tmp: string;
    const originalHome = process.env.TRADERKIT_HOME;

    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), "traderkit-session-"));
      process.env.TRADERKIT_HOME = tmp;
    });

    afterEach(() => {
      if (originalHome === undefined) delete process.env.TRADERKIT_HOME;
      else process.env.TRADERKIT_HOME = originalHome;
      rmSync(tmp, { recursive: true, force: true });
    });

    it("writes JSON + MD to $TRADERKIT_HOME/sessions/<date>/", async () => {
      const r: any = await sessionWriteHandler({
        action: "save",
        profile: "personal",
        mode: "dry-run",
        date: "2026-04-19",
        nav: 847772,
        regime_tier: "CAUTION",
        executed: [],
        deferred: [],
        no_trades: [
          { ticker: "AAPL", reason: "concentration cap" },
        ],
      });
      expect(r.session_id).toMatch(/^2026-04-19-personal-dry-run-/);
      expect(r.json_path).toContain(join(tmp, "sessions", "2026-04-19"));
      expect(r.md_path).toMatch(/\.md$/);
      expect(r.local_root).toBe(join(tmp, "sessions"));

      const json = JSON.parse(readFileSync(r.json_path, "utf8"));
      expect(json.profile).toBe("personal");
      expect(json.mode).toBe("dry-run");
      expect(json.regime_tier).toBe("CAUTION");
      expect(json.no_trades).toHaveLength(1);

      const md = readFileSync(r.md_path, "utf8");
      expect(md).toContain("personal · dry-run · 2026-04-19");
      expect(md).toContain("**AAPL**");
    });

    it("accepts pre-formatted markdown_body", async () => {
      const r: any = await sessionWriteHandler({
        action: "save",
        profile: "bildof",
        mode: "dry-run",
        markdown_body: "# custom header\n\nbody here",
      });
      const md = readFileSync(r.md_path, "utf8");
      expect(md).toContain("# custom header");
    });
  });
});
