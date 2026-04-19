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

Twenty-three MCP tools that sit between your AI assistant and your broker:

| Tool | Purpose |
|------|---------|
| **Pre-trade gates** | |
| `check_trade` | Gate a proposed trade against caps + wash-sale rules |
| `check_wash_sale` | Standalone ±30-day wash-sale window check |
| `regime_gate` | Market regime sizing gate — adjusts notional, blocks actions by tier |
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
| **Session management** | |
| `list_profiles` | List configured trading profiles |
| `set_profile` | Set the active profile for the session |
| `trading_calendar` | NYSE trading calendar: trading day checks, next/prev, last-of-month, count between |
| `session_write` | Format session doc sections: executed table, deferred list, no-trade log, index row |

### `check_trade`

The primary gate. Validates:

- **Order size cap** — rejects if `notional_usd` exceeds `max_order_notional`
- **Concentration cap** — rejects if post-trade single-name exposure exceeds `max_single_name_pct`
- **Forbidden tools** — blocks specific broker tools (e.g., margin tools)
- **Forbidden leg shapes** — blocks option structures (e.g., `naked_put`, `naked_call`)
- **Wash-sale check** — flags if same ticker was sold at a loss within ±30 days (same `tax_entity`)

Returns `{ pass: boolean, reasons: string[], warnings: string[] }`.

### `check_wash_sale`

Standalone wash-sale check. Pulls last 30 days of activity from a sibling [snaptrade-mcp-ts](https://www.npmjs.com/package/snaptrade-mcp-ts) server. Pools all accounts under the same `tax_entity` (e.g., all personal accounts share one wash-sale window; an LLC has its own).

Graceful degradation: if snaptrade-read is unavailable, returns `flagged: false` with a warning rather than blocking.

### `scan_tlh`

Scans your positions for tax-loss harvesting opportunities. Filters to positions with unrealized loss above a threshold (default $500), then excludes any that would trigger a wash sale. Returns candidates sorted by loss size (largest first).

Requires positions data as input (from `snaptrade_get_positions` or equivalent).

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

Get your `account_id` from `snaptrade_list_accounts`.

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
| `SNAPTRADE_CONSUMER_KEY` | For SnapTrade | SnapTrade credentials — used here for activity lookups (wash-sale, TLH) and by companion [snaptrade-mcp-ts](https://www.npmjs.com/package/snaptrade-mcp-ts) for trade execution |
| `SNAPTRADE_USER_SECRET` | For SnapTrade | |
| `SNAPTRADE_USER_ID` | For SnapTrade | |
| `SNAPTRADE_CLIENT_ID` | For SnapTrade | |
| `SNAPTRADE_READ_COMMAND` | For SnapTrade | Command to spawn snaptrade-mcp-ts (e.g., `npx`) |
| `SNAPTRADE_READ_ARGS` | For SnapTrade | Args for the command (e.g., `-y snaptrade-mcp-ts`) |
| `FMP_API_KEY` | For fundamentals | Financial Modeling Prep API key (free tier: 250 calls/day) — used by `fmp_fundamentals`, `screen_options`, `inst_holdings` |
| `UW_API_KEY` | For options | Unusual Whales API key — used by `screen_options`, `calc_max_pain` |
| `FINNHUB_API_KEY` | For options | Finnhub API key — used by `screen_options` (earnings calendar) |
| `SEC_USER_AGENT` | No | SEC EDGAR User-Agent override (defaults to `traderkit-mcp research (contact: <email>)`) — SEC fair-use requires contact email |

## How it works

```
Claude Code ──PreToolUse hook──► traderkit MCP
                                    │
                                    ├─ caps check (profile YAML)
                                    ├─ wash-sale check (snaptrade-mcp-ts)
                                    │
                                    ▼
                              pass/block decision
```

- **Fail-closed by default.** If traderkit can't evaluate a trade, it blocks.
- **Credential redaction.** All tool responses are scrubbed — any env secret substring (8+ chars) is replaced with `<REDACTED>`.
- **Tax-entity pooling.** Wash-sale checks span all accounts with the same `tax_entity`. Personal brokerage + IRA = one pool. LLC = separate pool.

## Supported brokers

Works with any broker connected via [SnapTrade](https://snaptrade.com/):

- Fidelity (read + write)
- E-Trade (read + write)
- IBKR (read + write)
- Schwab (read + write)
- Robinhood (read-only)
- TradeStation (via separate [TradeStation MCP](https://github.com/anthropics/anthropic-cookbook/tree/main/misc/tradestation_mcp))

## Full setup

For the complete trading terminal setup (vault templates, profiles, scripts, docs), see the [traderkit repo](https://github.com/nkrvivek/traderkit).

## License

MIT
