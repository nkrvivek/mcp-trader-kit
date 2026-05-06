# traderkit

Risk-gate MCP server for AI-assisted trading. Enforces position caps, wash-sale rules, and forbidden-structure checks before any order hits your broker.

Built for [Claude Code](https://claude.ai/claude-code) + [SnapTrade](https://snaptrade.com/). Works with any MCP client.

## Install

```bash
npx -y traderkit
```

Or globally:

```bash
npm install -g traderkit
```

## What it does

Thirty-two MCP tools that sit between your AI assistant and your broker:

| Tool | Purpose |
|------|---------|
| **Pre-trade gates** | |
| `check_trade` | Composite gate: caps + wash-sale + R0 freshness + R1 expiry-window + R2 strike-grid + R7 thesis-required |
| `check_wash_sale` | Standalone ±30-day wash-sale window check |
| `regime_gate` | Market regime sizing gate — adjusts notional, blocks actions by tier |
| **Execution discipline (R0–R8, R14)** | |
| `verify_fill` | R4: classify fill status (executed / partial-fill N/M / submitted-unverified) before session_write marks executed |
| `repricing_check` | R3: flag stale DAY LMT orders (>30min + >2% adverse move) → REPRICE. BAG path (R14): if `legs` + `near_leg_dte` supplied, consults `combo_fillability` → emits leg-out plan instead of reprice on LOW. |
| `reconcile_reminder` | R5: IBKR multi-leg → require IB Flex reconcile within 24h; returns shell command |
| `expiry_priority` | R8: expiry-day ordering (ITM→ATM→OTM→new-cycle) w/ violation flags |
| `combo_fillability` | R14: multi-leg BAG fillability score (HIGH/MEDIUM/LOW) + suggestion (SUBMIT/REPRICE_MID/LEG_OUT/CANCEL). On LOW returns `leg_out_plan` (BTC near @ ask + STO far @ bid). Origin: BBAI 2026-04-23 $4P Apr-24/May-01 calendar roll — 3 reprices $0.10→$0.05→$0.00 zero fill → canceled → forced assignment. |
| **Portfolio analysis** | |
| `check_concentration` | Portfolio concentration analysis with HEADROOM/NEAR-CAP/AT-CAP/OVER-CAP labels + HHI |
| `scan_tlh` | Find tax-loss harvesting candidates (wash-sale-clean) |
| `classify_holding` | Classify holdings into tiers (CORE/OPPORTUNISTIC/SPECULATIVE/PURE_SPECULATIVE) |
| `trigger_check` | Detect events: NAV moves, regime shifts, concentration breaches |
| `performance_metrics` | Sharpe, Sortino, max drawdown, Calmar ratio, win rate from returns series |
| **Options research** | |
| `screen_options` | Screen CSP/CC/PCS/CCS candidates by IV rank, delta, DTE, credit, YoR, OI, earnings |
| `calc_roll` | Credit-first roll-finder for short options; ranks by (net_credit / DTE_ext) × new_POP |
| `calc_max_pain` | Max Pain strike + OI walls; returns pain curve + P/C ratio + pin-drift notes |
| **Fundamentals + smart-money** | |
| `fmp_fundamentals` | Per-ticker quote, DCF, analyst targets, next earnings (via FMP free tier) |
| `inst_holdings` | 13F institutional holdings (by_ticker / by_fund / list_funds) — curated CIK map for Citadel, BlackRock, Berkshire, Pershing, etc. |
| `track_activists` | SEC EDGAR activist filings tracker (13D/13D/A/13G/DEF 14A); curated activist CIKs (Icahn, Elliott, Starboard, Pershing, Loeb, Peltz, ValueAct) |
| **Proposal + tax** | |
| `propose_trade` | Assemble a sized trade proposal with concentration headroom and regime adjustment |
| `track_tax` | Running STCG/LTCG tax exposure from realized trades with per-trade breakdown |
| `signal_rank` | Rank trading signals by composite confidence with multi-source boosting |
| `thesis_fit` | Score trade alignment to active theses (IN_THESIS/PARTIAL/OFF_THESIS/NO_THESIS_REF) |
| `broker_route` | Classify broker routing: SNAPTRADE/TRADESTATION/MANUAL/DEFERRED |
| **Flow signals (radon port)** | |
| `fetch_flow` | Per-ticker darkpool + options flow over N trading days w/ combined signal (STRONG_BULLISH_CONFLUENCE / STRONG_BEARISH_CONFLUENCE / DP_*_ONLY / OPTIONS_*_ONLY / NO_SIGNAL) |
| `fetch_oi_changes` | Per-ticker or market-wide OI change scanner w/ premium tiers (MASSIVE ≥$10M / LARGE ≥$5M / SIGNIFICANT ≥$1M / MODERATE) and bias (STRONGLY_BULLISH / BULLISH / NEUTRAL / BEARISH / STRONGLY_BEARISH) |
| `flow_analysis` | Position-aware classifier: routes positions into supports / against / watch / neutral against current flow direction (broker-agnostic — takes positions[] input) |
| `discover_flow` | Market-mode + targeted-mode candidate discovery; scoring weights dp_strength=30, dp_sustained=20, confluence=20, vol_oi=15, sweeps=15 |
| **LLM Trading Council (model-diverse synthesis)** | |
| `llm_council` | Karpathy 3-stage council (independent analysis → cross-rank → chair synthesis) across multiple LLMs (Anthropic + OpenAI + Google). Returns structured `{verdict, conviction, consensus_met, agreement_score, pros[], cons[], recommendation, sizing_note, disagreement_points[], model_rankings, stage1_voices, stage1_verdict_tally}`. Tensor-Trade Skeptic-seat pattern: permanent contrarian seat counts toward consensus. |
| **Session management** | |
| `list_profiles` | List configured trading profiles |
| `set_profile` | Set the active profile for the session |
| `trading_calendar` | NYSE trading calendar: trading day checks, next/prev, last-of-month, count between |
| `session_write` | Format session doc sections: executed table, deferred list, no-trade log, index row |

### `llm_council`

Model-diverse synthesis layer for high-conviction trade proposals. Ports the [karpathy/llm-council](https://github.com/karpathy/llm-council) 3-stage pattern (collect → cross-rank → chair synthesize) and combines it with the Tensor-Trade Skeptic-seat pattern (permanent contrarian seat).

**Why:** role-based debates (bull/bear/PM) suffer when every "voice" runs on the same model — they share inductive biases. The council adds **model diversity** (Claude vs GPT vs Gemini) orthogonal to the role diversity. Both feed into the final decision.

**Three-stage flow per proposal:**

1. **Stage 1 — Independent analysis** (parallel, N seats). Each seat gets the candidate proposal + portfolio context + regime + thesis text + analyst reports + book rules. Returns structured envelope: `{thesis, supporting_points[], risks[], verdict: BUY|HOLD|SELL, confidence: HIGH|MED|LOW}`. Failed seats silently dropped.
2. **Stage 2 — Cross-ranking** (parallel, N seats, anonymized). Each seat sees Stage-1 outputs labeled "Response A/B/C/…" (no model names) and ranks all by analytical quality. Format-enforced output: `FINAL RANKING:\n1. Response X\n2. …`. Acts as orthogonal quality signal.
3. **Stage 3 — Chair synthesis** (single call). Chairman receives de-anonymized Stage-1 + Stage-2 rankings and emits the structured JSON verdict.

**Output shape (Stage 3 chair JSON):**

```json
{
  "verdict": "BUY|HOLD|SELL|DEFER",
  "conviction": "LOW|MED|HIGH",
  "consensus_met": true,
  "agreement_score": 0.83,
  "pros": ["…", "…"],
  "cons": ["…", "…"],
  "recommendation": "Single-sentence actionable recommendation.",
  "sizing_note": "size×0.5 etc.",
  "disagreement_points": [
    {"topic": "Earnings risk", "bull_view": "…", "bear_view": "…", "models_split": {"bull": ["claude-opus-4-7"], "bear": ["gpt-5.1", "gemini-3-pro-preview"]}}
  ],
  "model_rankings": {"claude-opus-4-7": 1, "gpt-5.1": 2},
  "stage1_voices": [{"seat": "…", "verdict": "…", "confidence": "…"}],
  "stage1_verdict_tally": {"BUY": 1, "HOLD": 4, "SELL": 1},
  "stage1_failures": [],
  "council_size": 6
}
```

**Consensus-threshold gating** (Tensor-Trade pattern): chair sets `verdict = "DEFER"` when fewer than `consensus_threshold` (config; default >50% of seats) Stage-1 voices align on the same verdict at HIGH/MED confidence. DEFER → proposal annotated read-only, downstream debate continues, PM may still APPROVE/REJECT but with explicit "council DEFER" flag.

**Permanent Skeptic seat** (Tensor-Trade overlay): one seat receives the same Stage-1 candidate prompt PLUS a contrarian system overlay ("Bias toward the bearish case unless evidence is overwhelming. Verdict default is HOLD or SELL"). Counts in consensus + chair synthesis. Chair is instructed to weight Skeptic as a contrarian gut-check, not as one-of-N equal voices.

**Stage-0 eligibility gates** (skip council, no LLM cost):

- `regime_tier === "halt"` + `skip_under_halt: true` → `{skipped: true, skip_reason: "regime_halt"}`
- `candidate.is_roll === true` + `skip_rolls: true` → `{skipped: true, skip_reason: "skip_rolls"}` (rolls have R1–R9 deterministic gates already)
- `candidate.signal_rank < min_signal_rank` (default 40 = TIER-1 floor) → `{skipped: true, skip_reason: "below_tier1"}`

**Failure handling:**

- One Stage-1 seat fails → dropped, council proceeds with N-1 (Karpathy pattern)
- All Stage-1 seats fail → `{degraded: true, reason: "all_models_failed"}`, downstream proceeds without council input
- Stage-2 ranking parse fails → fall back to no-rank (chair sees raw responses)
- Chair fails → returns Karpathy-style fallback `{verdict: "HOLD", recommendation: "Council chair unavailable"}` with `degraded: true`
- 120s per-call timeout, no retry (one-shot, fail loud)

**Provider routing:** direct SDKs (Anthropic Messages API + OpenAI Chat Completions + Google Gemini). No OpenRouter dependency. The internal `LlmCaller` is provider-routed, so adding a fourth provider = adding one client method.

**Cost / latency** (validated 2026-05-05): 6-seat council × 3 stages × ~3K tokens/call ≈ **$0.15–0.50 per proposal**, **~25–30s wall time**. Cache TTL 4h at `cache/council-verdicts/{date}/{ticker}.json`. Per-run cap `max_council_runs: 5` (hard upper bound).

**Inputs:**

```typescript
{
  candidate: { ticker, structure, direction, qty, notional_usd, signal_rank, thesis_ref?, rationale, is_roll? },
  regime_tier: "clear" | "caution" | "defensive" | "halt",
  portfolio_context: string,
  thesis_text?: string,
  analyst_reports?: { fundamentals_md?, market_md?, news_md?, sentiment_md? },
  council_seats: [{ model, provider: "anthropic"|"openai"|"google", stance: "neutral"|"skeptic" }, ...],
  chairman_model: string,
  chairman_provider: "anthropic" | "openai" | "google",
  consensus_threshold?: number,    // default ceil(seats * 0.51)
  skip_under_halt?: boolean,       // default true
  skip_rolls?: boolean,            // default true
  min_signal_rank?: number,        // default 40
  max_tokens_per_call?: number,    // default 1500
  cache_ttl_hours?: number,        // default 4
}
```

**Recommended seat configuration** (5 neutral + 1 Skeptic, 3 providers):

```yaml
seats:
  - {model: "claude-opus-4-7",      provider: "anthropic", stance: "neutral"}
  - {model: "claude-sonnet-4-6",    provider: "anthropic", stance: "neutral"}
  - {model: "gpt-5.1",              provider: "openai",    stance: "neutral"}
  - {model: "gpt-4o",               provider: "openai",    stance: "neutral"}
  - {model: "gemini-3-pro-preview", provider: "google",    stance: "neutral"}
  - {model: "claude-sonnet-4-6",    provider: "anthropic", stance: "skeptic"}
chairman_model: "gemini-3-pro-preview"
chairman_provider: "google"
consensus_threshold: 4    # >50% of 6
```

Chair anti-bias instruction (auto-injected): *"Where seats from one provider agree among themselves but seats from another provider disagree, weight the cross-provider dissent more heavily — assume your own provider may share blind spots."*

### `check_trade`

The primary gate. Validates, in order:

- **R0 freshness (hard)** — every live-data input must carry an `as_of` ISO timestamp within its TTL. Missing/stale = reject. No inline opt-out.
- **Order size cap** — rejects if `notional_usd` exceeds `max_order_notional`
- **Concentration cap** — rejects if post-trade single-name exposure exceeds `max_single_name_pct`; in strict_mode also rejects when `portfolio_total_usd` is missing
- **Forbidden tools** — blocks specific broker tools (e.g., margin tools)
- **Forbidden leg shapes** — blocks option structures (e.g., `naked_put`, `naked_call`)
- **R1 expiry-day window** — blocks new short legs on expiry day during configured window (default 13:30–14:30Z)
- **R2 strike-grid** — requires ≥3 adjacent strikes w/ theta-per-Δ comparison; rejects selection materially worse than best
- **R7 thesis-required** — requires active `thesis_ref` (or declared `discretionary_event` + ≥10-char rationale)
- **Wash-sale check** — flags if same ticker was sold at a loss within ±30 days (same `tax_entity`)

Returns `{ pass: boolean, reasons: string[], warnings: string[], ticket_id?: string }`. Each run also appends to `$TRADERKIT_HOME/gate_audit/YYYY-MM-DD.jsonl` (hash-chained append-only audit).

**Stale data = no trade, ever.** In `strict_mode` (default true), any gate that can't verify its data fails-closed. Disable individual rules only via profile-level toggles (`rules.R0_no_stale_data: false`), not per-request.

### `verify_fill` (R4)

Compare intended vs filled quantities per leg and coerce session status. Required before `session_write` marks status as `executed`.

Input: `legs[{leg_id, intended_qty, filled_qty, status?}]` + `source` tag (`ib-gateway` | `ib-flex` | `snaptrade-list-orders` | `tradestation` | `manual`).

Returns `overall_status` (`executed` | `partial-fill` | `submitted-unverified` | `failed`), `coerced_status_label` for ready-to-write frontmatter, `safe_to_mark_executed: boolean`, and warnings (e.g., `ib-gateway` auto-warn that Friday fills are only visible via Flex on Monday).

### `repricing_check` (R3)

Given an order in flight — `submitted_at`, `limit_price`, `underlying_price_at_submit`, `underlying_price_now` — returns `action` (`HOLD` | `REPRICE` | `CANCEL`) + reasons. Flags `REPRICE` when age ≥ `stale_minutes` (default 30) AND underlying moved ≥ `adverse_move_pct` (default 2%).

### `reconcile_reminder` (R5)

After any IBKR multi-leg session (`order_count ≥ 2`), checks whether IB Flex reconcile is overdue vs `sla_hours` (default 24). Returns the shell command to run with the configured query_id: `cd ~/Development/radon && .venv/bin/python3 scripts/trade_blotter/flex_query.py --json --query-id <qid>`.

### `combo_fillability` (R14)

Rule-based heuristic for multi-leg option combo fills (calendars, verticals, diagonals). Inputs: legs (action/right/strike/expiry/ratio), `net_price`, `tif`, `underlying_price`, `underlying_adv_30d`, leg mid quotes (`mid`, optional `bid`/`ask`/`oi`/`dte`), `now`, `close_time`.

Scores HIGH/MEDIUM/LOW from: near-leg DTE/OI, underlying ADV, spot-to-near-strike distance, minutes-to-close, leg-width, net-price-vs-combo-mid slippage. Returns `{score, suggestion: SUBMIT | REPRICE_MID | LEG_OUT | CANCEL, reasons[], leg_out_plan?}`. On `LEG_OUT`, `leg_out_plan` gives the two single-leg market orders (BTC near @ ask, STO far @ bid) with estimated net and slippage-vs-combo-mid.

Origin: BBAI 2026-04-23 $4P Apr-24/May-01 calendar roll (permId 2061124997). Three combo reprices $0.10 → $0.05 → $0.00 got zero fill in 18 min; order was canceled and the short $4P went to assignment. Fix: detect LOW fillability at T-60 (thin near leg OI=7, DTE=1, minutes-to-close < 60) and leg out instead of racing the combo down to zero.

`calc_roll` warns automatically when near leg is thin and includes per-candidate `leg_out` plans. `propose_trade` consumes `roll_context` and surfaces the suggestion in the plan. `repricing_check` routes to the BAG path when `legs` + `near_leg_dte` are passed.

### `expiry_priority` (R8)

Given `expiring_legs[]` (w/ strike, underlying_price, option_type, side) and planned `new_cycle_legs[]`, returns an ordered processing list (ITM first → ATM → OTM → new-cycle) and flags violations when ITM/ATM resolution is pending while new-cycle writes are queued.

### `check_wash_sale`

Standalone wash-sale check. Pulls last 30 days of activity from a sibling [snaptrade-trade-mcp](https://www.npmjs.com/package/snaptrade-trade-mcp) server. Pools all accounts under the same `tax_entity` (e.g., all personal accounts share one wash-sale window; an LLC has its own).

Graceful degradation: if snaptrade-read is unavailable, returns `flagged: false` with a warning rather than blocking.

### `scan_tlh`

Scans your positions for tax-loss harvesting opportunities. Filters to positions with unrealized loss above a threshold (default $500), then excludes any that would trigger a wash sale. Returns candidates sorted by loss size (largest first).

Requires positions data as input (from `get_positions` or equivalent).

### `check_concentration`

Analyzes portfolio concentration against profile caps. Returns every position labeled:

- **HEADROOM** — well below cap
- **AT-CAP** — 75-90% of cap
- **NEAR-CAP** — 90-100% of cap
- **OVER-CAP** — exceeds cap

Also returns the [HHI](https://en.wikipedia.org/wiki/Herfindahl%E2%80%93Hirschman_index) (Herfindahl-Hirschman Index) as a single-number diversification score, and the top 5 positions.

### `regime_gate`

Checks if a trade should proceed under the current market regime:

| Tier | Size multiplier | Max DTE | Blocked actions |
|------|----------------|---------|-----------------|
| CLEAR | 1.0x | unlimited | none |
| CAUTION | 0.75x | 45 DTE | none |
| DEFENSIVE | 0.5x | 30 DTE | BUY, BUY_TO_OPEN |
| HALT | 0.25x | 14 DTE | BUY, BUY_TO_OPEN, SELL_TO_OPEN |

Returns adjusted notional, preferred structures for the tier, and whether the proposed structure aligns.

### `propose_trade`

End-to-end trade proposal builder. Takes a ticker, price, portfolio context, and regime tier. Produces a fully sized proposal with:

- **Headroom-based sizing** — `(cap% - current%) × 0.5 × NAV × regime_multiplier`
- **Cap enforcement** — capped at profile's `max_order_notional`
- **Regime blocking** — rejects BUY in DEFENSIVE/HALT
- **Concentration check** — rejects adds when already OVER-CAP
- **Sizing trace** — human-readable formula for audit

Optional: attach `thesis_ref` and `signal_summary` for proposal context.

### `track_tax`

Computes running tax exposure from an array of realized trades:

- Separates STCG (<365 days) from LTCG (≥365 days)
- Computes reserves at configurable rates (defaults: STCG 35.8%, LTCG 18.8%)
- Tracks gains and losses separately per bucket
- Flags wash-sale-adjusted trades
- Returns per-trade breakdown sorted by date

### `trigger_check`

Event detector for portfolio monitoring. Checks three conditions:

- **NAV_MOVE** — triggers on ±2% NAV change (configurable). CRITICAL at ±4%.
- **REGIME_SHIFT** — fires when regime tier changes. CRITICAL on deterioration, INFO on improvement.
- **CONCENTRATION_BREACH** — flags positions exceeding the cap. CRITICAL when 10pp+ over.

Returns events sorted by severity (CRITICAL → WARNING → INFO).

### `performance_metrics`

Computes portfolio performance metrics from a daily returns series:

- **Sharpe ratio** — risk-adjusted return (sample variance, annualized)
- **Sortino ratio** — downside-only volatility version
- **Max drawdown** — largest peak-to-trough decline (fraction 0–1), with peak/trough indices
- **Calmar ratio** — annualized return / max drawdown
- **Win rate** — fraction of positive returns, plus average win and average loss

Requires minimum 20 observations by default (configurable via `min_observations`). Supports custom `risk_free_rate` (default 5%) and `periods_per_year` (default 252).

### `thesis_fit`

Scores how well a trade aligns with active theses:

- **IN_THESIS** — ticker + structure match an active thesis
- **PARTIAL** — ticker matches but structure doesn't
- **OFF_THESIS** — ticker not in thesis, or thesis is closed
- **NO_THESIS_REF** — no `thesis_ref` provided

Supports `score_fit` (single) and `batch_score` (portfolio-wide). Batch returns a summary with counts per score tier.

### `trading_calendar`

NYSE trading calendar with 10 observed holidays + Good Friday. Five actions:

- `is_trading_day` — check if a date is a trading day
- `next_trading_day` / `prev_trading_day` — find adjacent trading days
- `last_trading_day_of_month` — useful for monthly rolls and reviews
- `trading_days_between` — count trading days in a range

### `session_write`

Formats session document sections as markdown. Four actions:

- `format_executed` — markdown table of executed trades
- `format_deferred` — bullet list with deferred tags
- `format_no_trade` — bullet list of rejected tickers with reasons
- `format_session_index_row` — 11-column index table row for session tracking

### `broker_route`

Classifies broker routing for order dispatch:

- **SNAPTRADE** — Fidelity, E-Trade, Robinhood, Schwab, IBKR
- **TRADESTATION** — TradeStation
- **MANUAL** — Ally, Morgan Stanley, unknown brokers
- **DEFERRED** — any trade with deferred tags (overrides broker classification)

## Setup

### 1. Create profiles

Profiles live in `~/.traderkit/profiles/` as markdown files with YAML frontmatter:

```yaml
---
name: personal
broker: snaptrade
account_id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
tax_entity: personal
caps:
  max_order_notional: 10000
  max_single_name_pct: 25
  forbidden_tools: []
  forbidden_leg_shapes: [naked_put, naked_call]
---
```

Get your `account_id` from `list_accounts`.

### 2. Register in Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "traderkit": { "command": "npx", "args": ["-y", "traderkit"] }
  }
}
```

### 3. Wire the PreToolUse hook

The companion [PreToolUse hook](https://github.com/nkrvivek/traderkit/blob/main/scripts/pre-tool-use.js) calls `check_trade` automatically before any destructive broker tool fires. Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__snaptrade-trade__equity_force_place|mcp__snaptrade-trade__mleg_place",
        "command": "node ~/.traderkit/scripts/pre-tool-use.js"
      }
    ]
  }
}
```

### 4. Verify

```bash
traderkit  # starts MCP server on stdio
```

In Claude Code: ask "list profiles" to confirm the server is connected.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TRADERKIT_ROOT` | No | Config root (default: `~/.traderkit`) |
| `TRADERKIT_FAIL_OPEN` | No | Set `true` to allow trades when server is unreachable (default: fail closed) |
| `ANTHROPIC_API_KEY` | For `llm_council` | Anthropic Messages API key — used by `claude-opus-*` and `claude-sonnet-*` seats |
| `OPENAI_API_KEY` | For `llm_council` | OpenAI Chat Completions API key — used by `gpt-5.x` and `gpt-4o` seats |
| `GEMINI_API_KEY` | For `llm_council` | Google Gemini API key — used by `gemini-3-pro-preview` seat / chair. Required only if Google seats are configured |
| `SNAPTRADE_CONSUMER_KEY` | For SnapTrade | SnapTrade credentials — used here for activity lookups (wash-sale, TLH) and by companion [snaptrade-trade-mcp](https://www.npmjs.com/package/snaptrade-trade-mcp) for trade execution |
| `SNAPTRADE_USER_SECRET` | For SnapTrade | |
| `SNAPTRADE_USER_ID` | For SnapTrade | |
| `SNAPTRADE_CLIENT_ID` | For SnapTrade | |
| `SNAPTRADE_READ_COMMAND` | For SnapTrade | Command to spawn snaptrade-trade-mcp (e.g., `npx`) |
| `SNAPTRADE_READ_ARGS` | For SnapTrade | Args for the command (e.g., `-y snaptrade-trade-mcp`) |
| `FMP_API_KEY` | For fundamentals | Financial Modeling Prep API key (free tier: 250 calls/day) — used by `fmp_fundamentals`, `screen_options`, `inst_holdings` |
| `UW_API_KEY` | For options | Unusual Whales API key — used by `screen_options`, `calc_max_pain` |
| `FINNHUB_API_KEY` | For options | Finnhub API key — used by `screen_options` (earnings calendar) |
| `SEC_USER_AGENT` | No | SEC EDGAR User-Agent override (defaults to `traderkit-mcp research (contact: <email>)`) — SEC fair-use requires contact email |
| `TS_CLIENT_ID` | For TradeStation | TradeStation OAuth app client_id (create at https://api.tradestation.com) |
| `TS_CLIENT_SECRET` | If app is confidential | TradeStation OAuth app client_secret (omit for public/PKCE-style apps) |
| `TS_REDIRECT_URI` | No | OAuth redirect URI; defaults to `http://localhost:5391/callback` (matches `ts-auth` listener) |
| `TS_TOKEN_PATH` | No | Token cache path; defaults to `~/.config/traderkit/tradestation.json` (mode 0600) |
| `TS_API_BASE` | No | API base; defaults to `https://api.tradestation.com/v3` |
| `TS_AUTH_BASE` | No | Auth base; defaults to `https://signin.tradestation.com` |
| `TS_SCOPES` | No | Authorize scopes; default `openid offline_access profile MarketData ReadAccount Trade` |
| `TS_REDIRECT_PORT` | No | Local listener port for `ts-auth`; default `5391` |
| `TS_AUDIENCE` | No | Authorize audience; default `https://api.tradestation.com` |

## How it works

```
Claude Code ──PreToolUse hook──► traderkit MCP
                                    │
                                    ├─ caps check (profile YAML)
                                    ├─ wash-sale check (snaptrade-trade-mcp)
                                    │
                                    ▼
                              pass/block decision
```

- **Fail-closed by default.** If traderkit can't evaluate a trade, it blocks.
- **Credential redaction.** All tool responses are scrubbed — any env secret substring (8+ chars) is replaced with `<REDACTED>`.
- **Tax-entity pooling.** Wash-sale checks span all accounts with the same `tax_entity`. Personal brokerage + IRA = one pool. LLC = separate pool.

## TradeStation (built-in)

Five MCP tools that talk directly to the TradeStation v3 REST API with persistent OAuth — no claude.ai connector, no token-expiry breakage:

| Tool | Purpose |
|------|---------|
| `ts_balances` | Account balances (cash, equity, BP, day-trade BP) for one or more `account_ids` |
| `ts_positions` | Open positions w/ Symbol/Quantity/AvgPrice/MarketValue/UnrealizedPL |
| `ts_quotes` | Real-time quotes for up to 50 symbols (incl. option contracts) |
| `ts_orders` | Working/recent orders for one or more `account_ids` |
| `ts_place_order` | Preview (default) or live order placement; live mode is **R6 human-gated** via `confirm_token: "PLACE-LIVE-ORDER"` |

### One-time auth flow

1. Create an OAuth app at https://api.tradestation.com — set redirect URI to `http://localhost:5391/callback` (or override via `TS_REDIRECT_URI`).
2. Export credentials:
   ```bash
   export TS_CLIENT_ID="<your-client-id>"
   export TS_CLIENT_SECRET="<your-client-secret>"   # only if your app is confidential
   ```
3. Run the OAuth helper — opens your browser, captures the auth code, exchanges for tokens, persists at `~/.config/traderkit/tradestation.json` (mode 0600):
   ```bash
   node dist/bin/ts-auth.js
   ```
   On success: `OK: token persisted to ~/.config/traderkit/tradestation.json`.

After that, every `ts_*` tool call auto-refreshes the access token (60s leeway) and retries once on `401` by forcing a refresh. Refresh tokens rotate on every refresh and persist to disk.

### Switching from the claude.ai TradeStation connector

Replace `mcp__claude_ai_TradeStation__*` calls with `mcp__traderkit__ts_*` in any phase doc / agent prompt. Coverage parity for the read paths used in trade-refresh:

| claude.ai connector tool | traderkit replacement |
|---|---|
| `get-balances-summary` / `get-balances-details` | `ts_balances` |
| `get-positions-details` / `get-positions-summary` | `ts_positions` |
| `get-quotes` / `get-option-quotes` | `ts_quotes` |
| `get-orders-detailed` / `get-orders-overview` | `ts_orders` |
| `confirm-order` | `ts_place_order` w/ `preview_only: true` (default) |
| `place-order` | `ts_place_order` w/ `preview_only: false` + `confirm_token: "PLACE-LIVE-ORDER"` |

## Supported brokers

Works with any broker connected via [SnapTrade](https://snaptrade.com/):

- Fidelity (read + write)
- E-Trade (read + write)
- IBKR (read + write)
- Schwab (read + write)
- Robinhood (read-only)
- TradeStation (built-in — see above; no SnapTrade dependency)

## Full setup

For the complete trading terminal setup (vault templates, profiles, scripts, docs), see the [traderkit repo](https://github.com/nkrvivek/traderkit).

## License

MIT
