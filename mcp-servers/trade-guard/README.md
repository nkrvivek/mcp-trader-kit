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

Seven MCP tools that sit between your AI assistant and your broker:

| Tool | Purpose |
|------|---------|
| `check_trade` | Gate a proposed trade against caps + wash-sale rules |
| `check_wash_sale` | Standalone ±30-day wash-sale window check |
| `scan_tlh` | Find tax-loss harvesting candidates (wash-sale-clean) |
| `check_concentration` | Portfolio concentration analysis with HEADROOM/NEAR-CAP/AT-CAP/OVER-CAP labels |
| `regime_gate` | Market regime sizing gate — adjusts notional, blocks actions by tier |
| `list_profiles` | List configured trading profiles |
| `set_profile` | Set the active profile for the session |

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
    "trade-guard": { "command": "npx", "args": ["-y", "traderkit"] }
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
| `SNAPTRADE_CONSUMER_KEY` | For wash-sale | SnapTrade credentials for activity lookups |
| `SNAPTRADE_USER_SECRET` | For wash-sale | |
| `SNAPTRADE_USER_ID` | For wash-sale | |
| `SNAPTRADE_CLIENT_ID` | For wash-sale | |
| `SNAPTRADE_READ_COMMAND` | For wash-sale | Command to spawn snaptrade-mcp-ts (e.g., `npx`) |
| `SNAPTRADE_READ_ARGS` | For wash-sale | Args for the command (e.g., `-y snaptrade-mcp-ts`) |

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
