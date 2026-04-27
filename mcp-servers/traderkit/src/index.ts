#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodObject, type ZodRawShape } from "zod";
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
import { FmpFundamentalsArgs, fmpFundamentalsHandler } from "./tools/fmp-fundamentals.js";
import { CalcMaxPainArgs, calcMaxPainHandler } from "./tools/calc-max-pain.js";
import { InstHoldingsArgs, instHoldingsHandler } from "./tools/inst-holdings.js";
import { TrackActivistsArgs, trackActivistsHandler } from "./tools/track-activists.js";
import { ExplainPayoffArgs, explainPayoffHandler } from "./tools/explain-payoff.js";
import { ReportTradesArgs, reportTradesHandler } from "./tools/report-trades.js";
import { VerifyFillArgs, verifyFillHandler } from "./tools/verify-fill.js";
import { RepricingCheckArgs, repricingCheckHandler } from "./tools/repricing-check.js";
import { ComboFillabilityArgs, comboFillabilityHandler } from "./tools/combo-fillability.js";
import { ReconcileReminderArgs, reconcileReminderHandler } from "./tools/reconcile-reminder.js";
import { ExpiryPriorityArgs, expiryPriorityHandler } from "./tools/expiry-priority.js";
import { EarningsCalendarArgs, earningsCalendarHandler } from "./tools/earnings-calendar.js";
import { RviGapArgs, rviGapHandler } from "./tools/rvi-gap.js";
import { redact } from "./redact.js";

function toolInput<S extends ZodRawShape>(
  schema: ZodObject<S>,
  _required: readonly (keyof S & string)[],
) {
  const js = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete js["$schema"];
  if (js["additionalProperties"] === undefined) {
    js["additionalProperties"] = false;
  }
  return js;
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
  { name: "session_write", description: "Format session sections (executed/deferred/no-trade/index row) OR save a full session locally. action=save writes JSON+MD to $TRADERKIT_HOME/sessions/<date>/<profile>-<mode>-<HHMMSS>.{json,md} (default ~/.traderkit/sessions). Always call at end of every run — dry-run, interactive, scheduled — for historical record + replay.",
    inputSchema: toolInput(SessionWriteArgs, ["action"]) },
  { name: "broker_route", description: "Classify broker routing: SNAPTRADE/TRADESTATION/MANUAL/DEFERRED based on broker name and deferred tags.",
    inputSchema: toolInput(BrokerRouteArgs, ["broker", "direction"]) },
  { name: "screen_options", description: "Screen option-selling candidates (CSP/CC/PCS/CCS) by IV rank, delta, DTE, credit, YoR, OI, earnings window. Returns ranked candidates w/ fundamentals (mkt cap, sector) + option Greeks from UW + Finnhub.",
    inputSchema: toolInput(ScreenOptionsArgs, ["tickers"]) },
  { name: "calc_roll", description: "Find roll candidates for an existing short option. Credit-first: filters strikes/expiries where STO_credit − BTC_cost >= min_net_credit. Ranks by (net_credit / DTE_ext) × new_POP.",
    inputSchema: toolInput(CalcRollArgs, ["ticker", "option_type", "current_strike", "current_expiry"]) },
  { name: "fmp_fundamentals", description: "FMP fundamentals per ticker — quote (spot, mkt cap), DCF, analyst price target (high/low/median/consensus), and next earnings date + timing (bmo/amc) + consensus EPS. Free tier: 250 calls/day; each ticker uses up to 4 calls. Use for thesis validation + earnings-blackout checks.",
    inputSchema: toolInput(FmpFundamentalsArgs, ["tickers"]) },
  { name: "calc_max_pain", description: "Compute Max Pain strike + OI walls for a ticker/expiry. Returns pain curve, put/call walls (support/resistance), P/C OI ratio, and interpretive notes (pin drift, wall strike candidates for CSP/CC). Uses UW option chain + stock state.",
    inputSchema: toolInput(CalcMaxPainArgs, ["ticker"]) },
  { name: "inst_holdings", description: "Institutional holdings tracker (13F). Modes: by_ticker (top 13F filers holding a stock, matched vs known funds like Citadel/BlackRock/Berkshire), by_fund (top positions of a named fund by key or CIK), list_funds (curated CIK map). Returns shares/market-value/weight + build/trim deltas w/ smart-money bias interpretation. FMP source — tier-dependent.",
    inputSchema: toolInput(InstHoldingsArgs, ["mode"]) },
  { name: "track_activists", description: "Activist/event-driven filings tracker via SEC EDGAR full-text search. Modes: by_ticker (who is filing 13D/13G on this stock?), by_fund (recent Pershing/Icahn/Elliott/Starboard filings), recent (market-wide activist scan), list_activists (curated activist CIKs: Ackman, Icahn, Elliott, Starboard, Loeb, Peltz, ValueAct, JANA, etc.). Surfaces 13D (hard intent), 13D/A (amendment), 13G (passive >5%), DEF 14A (proxy). Fresh 13D = priority.",
    inputSchema: toolInput(TrackActivistsArgs, ["mode"]) },
  { name: "explain_payoff", description: "Plain-English payoff narration for a proposed trade. Supports covered_call, cash_secured_put, put_credit_spread, call_credit_spread, long_stock. Returns narrative + scenarios (win/partial/worst), breakeven, max profit/loss in dollars. Use in Phase 4 alongside propose_trade so users see 'if X happens you make $Y' before approving. Demystifies options for new traders.",
    inputSchema: toolInput(ExplainPayoffArgs, ["ticker", "structure", "spot"]) },
  { name: "report_trades", description: "Weekly/monthly trade scoreboard. Reads $TRADERKIT_HOME/sessions/**/*.json (from session_write action=save) and aggregates: trades executed, premium collected, realized P&L, win rate, breakdown by structure/ticker/regime. Defaults to last 7 days, live modes only (include_dry_run=true to include paper trades). Answers 'how did my covered-call ladder actually perform?' without a vault.",
    inputSchema: toolInput(ReportTradesArgs, []) },
  { name: "verify_fill", description: "R4 fill verification. Compare intended vs filled quantities per leg and coerce session status label ('executed' | 'partial-fill (N/M)' | 'submitted-unverified' | 'failed'). Required before any session_write status=executed. Source tag required (ib-gateway | ib-flex | snaptrade-list-orders | tradestation | manual). Origin: BBAI 2026-04-17 ×25 SP submitted / 1 filled while session marked executed → 2-day vault drift.",
    inputSchema: toolInput(VerifyFillArgs, ["source", "legs"]) },
  { name: "repricing_check", description: "R3 DAY LMT repricing check. Flags stale orders: if age ≥ stale_minutes AND underlying moved ≥ adverse_move_pct, returns REPRICE action. Origin: BBAI $3 May-15 SP × 25 @ $0.10 LMT DAY stayed unfilled 2+h while stock rallied 8.2% → only 1/25 filled.",
    inputSchema: toolInput(RepricingCheckArgs, ["ticker", "direction", "limit_price", "submitted_at", "underlying_price_at_submit", "underlying_price_now", "intended_qty"]) },
  { name: "reconcile_reminder", description: "R5 Flex reconcile reminder. IBKR multi-leg sessions must be reconciled against IB Flex within 24h — otherwise vault drifts. Returns shell command w/ configured query_id.",
    inputSchema: toolInput(ReconcileReminderArgs, ["broker", "order_count", "session_at"]) },
  { name: "expiry_priority", description: "R8 expiry-day priority stack. Orders expiring legs ITM→ATM→OTM, then new-cycle writes. Flags violations when ITM/ATM legs present alongside new-cycle writes (must process rolls/closes first).",
    inputSchema: toolInput(ExpiryPriorityArgs, []) },
  { name: "rvi_gap", description: "Realized-vs-implied volatility gap. Computes IV-HV gap, ratio, and z-score vs IV history (when supplied). Emits action (SELL_PREMIUM if z≥+1.2σ → premium-rich / BUY_PREMIUM if z≤−1.2σ → premium-cheap / NEUTRAL between). Fallback ratio mode (no history): ratio≥1.5 → SELL, ≤0.8 → BUY. Returns signal_for_confluence object ready to feed signal_rank's VOLATILITY channel.",
    inputSchema: toolInput(RviGapArgs, ["ticker", "iv_30d", "hv_30d"]) },
  { name: "earnings_calendar", description: "Earnings calendar preload for held + watchlist tickers. Filters to tickers of interest, computes days_until + earnings_window (TODAY/WITHIN_2D/WITHIN_7D/WITHIN_14D), surfaces conflicting open option legs, and emits flags (R1 held-into-earnings, RED-tier IV crush warning, GREEN-tier candidate, SHORT-leg-thru-earnings). Returns earnings_within_days_map + iv_tier_map ready to feed signal_rank for confluence scoring.",
    inputSchema: toolInput(EarningsCalendarArgs, ["as_of"]) },
  { name: "combo_fillability", description: "R14 BAG (multi-leg combo) fillability score. Rule-based heuristic: near-leg DTE/OI, underlying ADV, spot-to-near-strike distance, minutes-to-close, leg-width, net-price-vs-combo-mid. Returns HIGH/MEDIUM/LOW + suggestion (SUBMIT/REPRICE_MID/LEG_OUT/CANCEL) + leg_out_plan (BTC near @ ask + STO far @ bid) when LOW. Origin: BBAI 2026-04-23 $4P Apr-24/May-01 calendar roll (permId 2061124997) — 3 reprices $0.10→$0.05→$0.00 zero fill → canceled → forced assignment. Fix: leg out at T-60, not reprice down.",
    inputSchema: toolInput(ComboFillabilityArgs, ["ticker", "legs", "net_price"]) },
];

const SECRETS = [
  process.env.SNAPTRADE_CONSUMER_KEY, process.env.SNAPTRADE_USER_SECRET,
  process.env.SNAPTRADE_USER_ID, process.env.SNAPTRADE_CLIENT_ID,
  process.env.UW_TOKEN, process.env.FINNHUB_API_KEY,
  process.env.FMP_API_KEY,
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
        case "fmp_fundamentals": result = await fmpFundamentalsHandler(req.params.arguments); break;
        case "calc_max_pain":  result = await calcMaxPainHandler(req.params.arguments); break;
        case "inst_holdings":  result = await instHoldingsHandler(req.params.arguments); break;
        case "track_activists": result = await trackActivistsHandler(req.params.arguments); break;
        case "explain_payoff": result = await explainPayoffHandler(req.params.arguments); break;
        case "report_trades":  result = await reportTradesHandler(req.params.arguments); break;
        case "verify_fill":    result = await verifyFillHandler(req.params.arguments); break;
        case "repricing_check": result = await repricingCheckHandler(req.params.arguments); break;
        case "reconcile_reminder": result = await reconcileReminderHandler(req.params.arguments); break;
        case "expiry_priority": result = await expiryPriorityHandler(req.params.arguments); break;
        case "combo_fillability": result = await comboFillabilityHandler(req.params.arguments); break;
        case "earnings_calendar": result = await earningsCalendarHandler(req.params.arguments); break;
        case "rvi_gap": result = await rviGapHandler(req.params.arguments); break;
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
