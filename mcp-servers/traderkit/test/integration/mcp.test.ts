import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DIST_INDEX = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

describe("traderkit stdio integration", () => {
  let kitRoot: string;
  let client: Client | undefined;

  beforeEach(async () => {
    kitRoot = await mkdtemp(join(tmpdir(), "tg-mcp-"));
    const profilesDir = join(kitRoot, "profiles");
    await mkdir(profilesDir, { recursive: true });
    await writeFile(
      join(profilesDir, "bildof.md"),
      `---\nname: bildof\nbroker: snaptrade\naccount_id: 11111111-1111-1111-1111-111111111111\ntax_entity: llc-bildof\ncaps:\n  max_order_notional: 5000\n  max_single_name_pct: 10\n---\nbody`
    );

    const filteredEnv: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
    );
    const env = { ...filteredEnv, TRADERKIT_ROOT: kitRoot };
    // Ensure server boots without attempting to connect to snaptrade-read
    delete (env as Record<string, string>)["SNAPTRADE_READ_COMMAND"];

    const transport = new StdioClientTransport({
      command: "node",
      args: [DIST_INDEX],
      env,
    });
    client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
  });

  afterEach(async () => {
    if (client) await client.close();
  });

  it("lists all tools", async () => {
    const r = await client!.listTools();
    const names = r.tools.map((t) => t.name).sort();
    expect(names).toEqual(["broker_route", "calc_max_pain", "calc_roll", "check_concentration", "check_trade", "check_wash_sale", "classify_holding", "combo_fillability", "expiry_priority", "explain_payoff", "fmp_fundamentals", "inst_holdings", "list_profiles", "performance_metrics", "propose_trade", "reconcile_reminder", "regime_gate", "report_trades", "repricing_check", "scan_tlh", "screen_options", "session_write", "set_profile", "signal_rank", "thesis_fit", "track_activists", "track_tax", "trading_calendar", "trigger_check", "verify_fill"]);
  });

  it("list_profiles returns the seeded profile", async () => {
    const r = await client!.callTool({ name: "list_profiles", arguments: {} });
    const text = (r.content as { text: string }[])[0].text;
    expect(text).toMatch(/bildof/);
  });

  it("check_trade rejects over-cap notional", async () => {
    const r = await client!.callTool({
      name: "check_trade",
      arguments: {
        profile: "bildof", tool: "equity_force_place", ticker: "AAPL",
        direction: "BUY", qty: 100, notional_usd: 20000,
        portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
        require_wash_sale_check: false,
      },
    });
    const text = (r.content as { text: string }[])[0].text;
    expect(text).toMatch(/notional/);
    expect(JSON.parse(text).pass).toBe(false);
  });
});
