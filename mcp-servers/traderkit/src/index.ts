#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ZodObject, ZodRawShape } from "zod";
import { loadAllProfiles } from "./profiles/loader.js";
import { PROFILES_DIR } from "./config.js";
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
import { ScreenOptionsArgs, screenOptionsHandler } from "./tools/screen-options.js";
import { CalcRollArgs, calcRollHandler } from "./tools/calc-roll.js";
import { redact } from "./redact.js";

function toolInput<S extends ZodRawShape>(
  schema: ZodObject<S>,
  required: readonly (keyof S & string)[],
) {
  return {
    type: "object" as const,
    additionalProperties: false as const,
    properties: schema.shape,
    required: [...required],
  };
}

const EMPTY_INPUT = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {},
  required: [] as string[],
};

const TOOLS = [
  { name: "check_trade", description: "Gate a proposed trade (caps + wash-sale).",
    inputSchema: toolInput(CheckTradeArgs, ["profile", "tool", "ticker", "direction", "qty", "notional_usd"]) },
  { name: "check_wash_sale", description: "Check wash-sale status for a ticker + action.",
    inputSchema: toolInput(CheckWashSaleArgs, ["ticker", "action", "tax_entity"]) },
  { name: "list_profiles", description: "List available trading profiles.",
    inputSchema: EMPTY_INPUT },
  { name: "set_profile", description: "Set the active profile in session state.",
    inputSchema: toolInput(SetProfileArgs, ["name"]) },
  { name: "scan_tlh", description: "Scan positions for tax-loss harvesting candidates (wash-sale-clean).",
    inputSchema: toolInput(ScanTlhArgs, ["tax_entity", "positions"]) },
  { name: "check_concentration", description: "Analyze portfolio concentration vs profile caps. Returns per-position labels (HEADROOM/NEAR-CAP/AT-CAP/OVER-CAP) and HHI.",
    inputSchema: toolInput(CheckConcentrationArgs, ["profile", "positions", "portfolio_total_usd"]) },
  { name: "regime_gate", description: "Check if a trade is allowed under the current market regime. Returns adjusted sizing, blocked actions, and preferred structures.",
    inputSchema: toolInput(RegimeGateArgs, ["regime_tier", "direction", "notional_usd"]) },
  { name: "propose_trade", description: "Assemble a sized trade proposal with concentration headroom, regime adjustment, and cap check.",
    inputSchema: toolInput(ProposeTradeArgs, ["profile", "ticker", "direction", "current_price", "portfolio_total_usd"]) },
  { name: "track_tax", description: "Compute running STCG/LTCG tax exposure from realized trades. Returns per-trade breakdown and reserve amounts.",
    inputSchema: toolInput(TrackTaxArgs, ["trades"]) },
  { name: "trigger_check", description: "Check for triggered events: NAV moves, regime shifts, concentration breaches. Returns severity-sorted event list.",
    inputSchema: toolInput(TriggerCheckArgs, ["current_nav", "previous_nav", "current_regime_tier"]) },
  { name: "signal_rank", description: "Rank trading signals by composite confidence. Multi-source confirmation boosts score. Deduplicates by (ticker, source).",
    inputSchema: toolInput(SignalRankArgs, ["signals"]) },
  { name: "classify_holding", description: "Classify holdings into tiers (CORE/OPPORTUNISTIC/SPECULATIVE/PURE_SPECULATIVE) based on NAV weight, thesis, and program membership.",
    inputSchema: toolInput(ClassifyHoldingArgs, ["holdings", "portfolio_total_usd"]) },
  { name: "trading_calendar", description: "NYSE trading calendar: check trading days, find next/prev trading day, last trading day of month, count trading days between dates.",
    inputSchema: toolInput(TradingCalendarArgs, ["action", "date"]) },
  { name: "performance_metrics", description: "Compute portfolio performance metrics: Sharpe, Sortino, max drawdown, Calmar ratio, win rate from a returns series.",
    inputSchema: toolInput(PerformanceMetricsArgs, ["returns"]) },
  { name: "thesis_fit", description: "Score how well a trade fits active theses (IN_THESIS/PARTIAL/OFF_THESIS/NO_THESIS_REF). Supports single and batch scoring.",
    inputSchema: toolInput(ThesisFitArgs, ["action", "theses"]) },
  { name: "session_write", description: "Format session document sections: executed trades table, deferred list, no-trade log, session index row.",
    inputSchema: toolInput(SessionWriteArgs, ["action"]) },
  { name: "broker_route", description: "Classify broker routing: SNAPTRADE/TRADESTATION/MANUAL/DEFERRED based on broker name and deferred tags.",
    inputSchema: toolInput(BrokerRouteArgs, ["broker", "direction"]) },
  { name: "screen_options", description: "Screen option-selling candidates (CSP/CC/PCS/CCS) by IV rank, delta, DTE, credit, YoR, OI, earnings window. Returns ranked candidates w/ fundamentals (mkt cap, sector) + option Greeks from UW + Finnhub.",
    inputSchema: toolInput(ScreenOptionsArgs, ["tickers"]) },
  { name: "calc_roll", description: "Find roll candidates for an existing short option. Credit-first: filters strikes/expiries where STO_credit − BTC_cost >= min_net_credit. Ranks by (net_credit / DTE_ext) × new_POP.",
    inputSchema: toolInput(CalcRollArgs, ["ticker", "option_type", "current_strike", "current_expiry"]) },
];

const SECRETS = [
  process.env.SNAPTRADE_CONSUMER_KEY, process.env.SNAPTRADE_USER_SECRET,
  process.env.SNAPTRADE_USER_ID, process.env.SNAPTRADE_CLIENT_ID,
  process.env.UW_TOKEN, process.env.FINNHUB_API_KEY,
].filter((x): x is string => !!x);

const SNAPTRADE_READ_ALLOWED_ENV = [
  "SNAPTRADE_CONSUMER_KEY",
  "SNAPTRADE_USER_SECRET",
  "SNAPTRADE_USER_ID",
  "SNAPTRADE_CLIENT_ID",
  "PATH",
  "HOME",
] as const;

function allowedEnv(allowlist: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of allowlist) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function main() {
  const allProfiles = await loadAllProfiles(PROFILES_DIR).catch(() => []);
  let snaptradeRead: SnaptradeReadClient | null = null;
  if (process.env.SNAPTRADE_READ_COMMAND) {
    try {
      snaptradeRead = await connectSnaptradeRead({
        command: process.env.SNAPTRADE_READ_COMMAND,
        args: (process.env.SNAPTRADE_READ_ARGS ?? "").split(" ").filter(Boolean),
        env: allowedEnv(SNAPTRADE_READ_ALLOWED_ENV),
      });
    } catch (e) {
      process.stderr.write(`traderkit: could not start snaptrade-read: ${(e as Error).message}\n`);
    }
  }

  const server = new Server({ name: "traderkit", version: "0.5.1" }, { capabilities: { tools: {} } });
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
        case "screen_options": result = await screenOptionsHandler(req.params.arguments); break;
        case "calc_roll":      result = await calcRollHandler(req.params.arguments); break;
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
  process.stderr.write(`traderkit: ready (profiles=${allProfiles.length})\n`);
}

main().catch((e) => { process.stderr.write(`traderkit fatal: ${e?.message}\n`); process.exit(1); });
