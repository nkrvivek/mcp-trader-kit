#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadAllProfiles } from "./profiles/loader.js";
import { KIT_ROOT, PROFILES_DIR } from "./config.js";
import { connectSnaptradeRead, type SnaptradeReadClient } from "./mcp/snaptrade-read-client.js";
import { CheckTradeArgs, checkTradeHandler } from "./tools/check-trade.js";
import { CheckWashSaleArgs, checkWashSaleHandler } from "./tools/check-wash-sale.js";
import { listProfilesHandler } from "./tools/list-profiles.js";
import { SetProfileArgs, setProfileHandler } from "./tools/set-profile.js";
import { ScanTlhArgs, scanTlhHandler } from "./tools/scan-tlh-handler.js";
import { CheckConcentrationArgs, checkConcentrationHandler } from "./tools/check-concentration.js";
import { RegimeGateArgs, regimeGateHandler } from "./tools/regime-gate.js";
import { ProposeTradeArgs, proposeTradeHandler } from "./tools/propose-trade.js";
import { TrackTaxArgs, trackTaxHandler } from "./tools/track-tax.js";
import { TriggerCheckArgs, triggerCheckHandler } from "./tools/trigger-check.js";
import { SignalRankArgs, signalRankHandler } from "./tools/signal-rank.js";
import { ClassifyHoldingArgs, classifyHoldingHandler } from "./tools/classify-holding.js";
import { TradingCalendarArgs, tradingCalendarHandler } from "./tools/trading-calendar.js";
import { PerformanceMetricsArgs, performanceMetricsHandler } from "./tools/performance-metrics.js";
import { ThesisFitArgs, thesisFitHandler } from "./tools/thesis-fit.js";
import { SessionWriteArgs, sessionWriteHandler } from "./tools/session-write.js";
import { BrokerRouteArgs, brokerRouteHandler } from "./tools/broker-route.js";
import { redact } from "./redact.js";

const TOOLS = [
  { name: "check_trade", description: "Gate a proposed trade (caps + wash-sale).",
    inputSchema: { type: "object", additionalProperties: false,
      properties: CheckTradeArgs.shape as any, required: ["profile", "tool", "ticker", "direction", "qty", "notional_usd"] } },
  { name: "check_wash_sale", description: "Check wash-sale status for a ticker + action.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: CheckWashSaleArgs.shape as any, required: ["ticker", "action", "tax_entity"] } },
  { name: "list_profiles", description: "List available trading profiles.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "set_profile", description: "Set the active profile in session state.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: SetProfileArgs.shape as any, required: ["name"] } },
  { name: "scan_tlh", description: "Scan positions for tax-loss harvesting candidates (wash-sale-clean).",
    inputSchema: { type: "object", additionalProperties: false,
      properties: ScanTlhArgs.shape as any, required: ["tax_entity", "positions"] } },
  { name: "check_concentration", description: "Analyze portfolio concentration vs profile caps. Returns per-position labels (HEADROOM/NEAR-CAP/AT-CAP/OVER-CAP) and HHI.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: CheckConcentrationArgs.shape as any, required: ["profile", "positions", "portfolio_total_usd"] } },
  { name: "regime_gate", description: "Check if a trade is allowed under the current market regime. Returns adjusted sizing, blocked actions, and preferred structures.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: RegimeGateArgs.shape as any, required: ["regime_tier", "direction", "notional_usd"] } },
  { name: "propose_trade", description: "Assemble a sized trade proposal with concentration headroom, regime adjustment, and cap check.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: ProposeTradeArgs.shape as any, required: ["profile", "ticker", "direction", "current_price", "portfolio_total_usd"] } },
  { name: "track_tax", description: "Compute running STCG/LTCG tax exposure from realized trades. Returns per-trade breakdown and reserve amounts.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: TrackTaxArgs.shape as any, required: ["trades"] } },
  { name: "trigger_check", description: "Check for triggered events: NAV moves, regime shifts, concentration breaches. Returns severity-sorted event list.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: TriggerCheckArgs.shape as any, required: ["current_nav", "previous_nav", "current_regime_tier"] } },
  { name: "signal_rank", description: "Rank trading signals by composite confidence. Multi-source confirmation boosts score. Deduplicates by (ticker, source).",
    inputSchema: { type: "object", additionalProperties: false,
      properties: SignalRankArgs.shape as any, required: ["signals"] } },
  { name: "classify_holding", description: "Classify holdings into tiers (CORE/OPPORTUNISTIC/SPECULATIVE/PURE_SPECULATIVE) based on NAV weight, thesis, and program membership.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: ClassifyHoldingArgs.shape as any, required: ["holdings", "portfolio_total_usd"] } },
  { name: "trading_calendar", description: "NYSE trading calendar: check trading days, find next/prev trading day, last trading day of month, count trading days between dates.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: TradingCalendarArgs.shape as any, required: ["action", "date"] } },
  { name: "performance_metrics", description: "Compute portfolio performance metrics: Sharpe, Sortino, max drawdown, Calmar ratio, win rate from a returns series.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: PerformanceMetricsArgs.shape as any, required: ["returns"] } },
  { name: "thesis_fit", description: "Score how well a trade fits active theses (IN_THESIS/PARTIAL/OFF_THESIS/NO_THESIS_REF). Supports single and batch scoring.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: ThesisFitArgs.shape as any, required: ["action", "theses"] } },
  { name: "session_write", description: "Format session document sections: executed trades table, deferred list, no-trade log, session index row.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: SessionWriteArgs.shape as any, required: ["action"] } },
  { name: "broker_route", description: "Classify broker routing: SNAPTRADE/TRADESTATION/MANUAL/DEFERRED based on broker name and deferred tags.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: BrokerRouteArgs.shape as any, required: ["broker", "direction"] } },
];

const SECRETS = [
  process.env.SNAPTRADE_CONSUMER_KEY, process.env.SNAPTRADE_USER_SECRET,
  process.env.SNAPTRADE_USER_ID, process.env.SNAPTRADE_CLIENT_ID,
].filter((x): x is string => !!x);

async function main() {
  const allProfiles = await loadAllProfiles(PROFILES_DIR).catch(() => []);
  let snaptradeRead: SnaptradeReadClient | null = null;
  if (process.env.SNAPTRADE_READ_COMMAND) {
    try {
      snaptradeRead = await connectSnaptradeRead({
        command: process.env.SNAPTRADE_READ_COMMAND,
        args: (process.env.SNAPTRADE_READ_ARGS ?? "").split(" ").filter(Boolean),
        env: process.env as Record<string, string>,
      });
    } catch (e) {
      process.stderr.write(`trade-guard: could not start snaptrade-read: ${(e as Error).message}\n`);
    }
  }

  const server = new Server({ name: "traderkit", version: "0.5.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const deps = { allProfiles, snaptradeRead };
    try {
      let result: unknown;
      switch (req.params.name) {
        case "check_trade":     result = await checkTradeHandler(req.params.arguments, deps); break;
        case "check_wash_sale": result = await checkWashSaleHandler(req.params.arguments, deps); break;
        case "list_profiles":   result = await listProfilesHandler(req.params.arguments, deps); break;
        case "set_profile":     result = await setProfileHandler(req.params.arguments, deps); break;
        case "scan_tlh":        result = await scanTlhHandler(req.params.arguments, deps); break;
        case "check_concentration": result = await checkConcentrationHandler(req.params.arguments, deps); break;
        case "regime_gate":     result = await regimeGateHandler(req.params.arguments); break;
        case "propose_trade":  result = await proposeTradeHandler(req.params.arguments, deps); break;
        case "track_tax":      result = await trackTaxHandler(req.params.arguments); break;
        case "trigger_check":  result = await triggerCheckHandler(req.params.arguments); break;
        case "signal_rank":    result = await signalRankHandler(req.params.arguments); break;
        case "classify_holding": result = await classifyHoldingHandler(req.params.arguments); break;
        case "trading_calendar": result = await tradingCalendarHandler(req.params.arguments); break;
        case "performance_metrics": result = await performanceMetricsHandler(req.params.arguments); break;
        case "thesis_fit":     result = await thesisFitHandler(req.params.arguments); break;
        case "session_write":  result = await sessionWriteHandler(req.params.arguments); break;
        case "broker_route":   result = await brokerRouteHandler(req.params.arguments); break;
        default: throw new Error(`unknown tool: ${req.params.name}`);
      }
      const safe = redact(result, SECRETS);
      return { content: [{ type: "text", text: JSON.stringify(safe, null, 2) }] };
    } catch (e) {
      const msg = (e as Error).message;
      const safeMsg = String(redact(msg, SECRETS));
      return { content: [{ type: "text", text: `error: ${safeMsg}` }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`trade-guard: ready (profiles=${allProfiles.length}, kit_root=${KIT_ROOT})\n`);
}

main().catch((e) => { process.stderr.write(`trade-guard fatal: ${e?.message}\n`); process.exit(1); });
