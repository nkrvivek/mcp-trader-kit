# traderkit

[![npm](https://img.shields.io/npm/v/traderkit)](https://www.npmjs.com/package/traderkit)
[![CI](https://github.com/nkrvivek/traderkit/actions/workflows/ci.yml/badge.svg)](https://github.com/nkrvivek/traderkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Risk-gate MCP server for AI-assisted trading. 23 tools that enforce caps, wash-sale rules, regime-based sizing, and portfolio analysis — plus options screening, 13F smart-money tracking, and activist-filing surveillance — before any order hits your broker.

Built for [Claude Code](https://claude.ai/claude-code). Works with any MCP client.

## Quick install

```bash
npx -y traderkit
```

## What it does

```
AI Assistant ──PreToolUse hook──► traderkit MCP (23 tools)
                                     │
                                     ├─ caps + wash-sale gate
                                     ├─ regime sizing (CLEAR → HALT)
                                     ├─ concentration analysis + HHI
                                     ├─ proposal assembly + tax tracking
                                     ├─ thesis fit scoring
                                     ├─ performance metrics
                                     │
                                     ▼
                               pass/block decision
```

| Category | Tools |
|----------|-------|
| **Pre-trade gates** | `check_trade`, `check_wash_sale`, `regime_gate` |
| **Portfolio analysis** | `check_concentration`, `scan_tlh`, `classify_holding`, `trigger_check`, `performance_metrics` |
| **Options screening + rolls** | `screen_options`, `calc_roll`, `calc_max_pain` |
| **Fundamentals + smart-money** | `fmp_fundamentals`, `inst_holdings`, `track_activists` |
| **Proposal + tax** | `propose_trade`, `track_tax`, `signal_rank`, `thesis_fit`, `broker_route` |
| **Session management** | `list_profiles`, `set_profile`, `trading_calendar`, `session_write` |

See the [npm package README](mcp-servers/traderkit/README.md) for detailed documentation of each tool.

## Full setup

Clone, run setup, trade:

```bash
git clone https://github.com/nkrvivek/traderkit
cd traderkit
npm install
./scripts/setup.sh
# edit ~/.traderkit/.env with credentials
# edit ~/.traderkit/profiles/*.md with your account_ids
./scripts/doctor.sh
cd vault && claude
```

See [SETUP.md](SETUP.md) for the full walkthrough.

### What `setup.sh` creates

```
~/.traderkit/
├── .env                     # broker credentials
├── profiles/                # trading profile YAML frontmatter
│   ├── personal.md
│   └── llc.md
├── scripts/
│   └── pre-tool-use.js      # PreToolUse hook (auto-gates trades)
└── vault/                   # Obsidian-style trading wiki
    ├── dashboard.md
    ├── market-regime.md
    ├── theses/
    ├── sessions/
    └── ...
```

### Profile example

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

### PreToolUse hook

The hook calls `check_trade` + `regime_gate` automatically before any destructive broker tool fires. Add to `.claude/settings.json`:

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

## Key design decisions

- **Fail-closed by default.** If traderkit can't evaluate a trade, it blocks.
- **Read-only risk gate.** Traderkit checks and sizes — it never places orders. Order execution stays with the broker MCP (SnapTrade, TradeStation).
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
- Ally, Morgan Stanley — manual execution only

## Disclaimer

This software places real orders against real brokerage accounts. The authors disclaim all liability for losses, tax consequences, broker-side errors, model hallucinations, or any other outcome of its use. **Not financial advice.** You are responsible for every order approved in the REPL. Test on paper/sandbox accounts first. Do not disable the PreToolUse hook. Do not remove the risk gates.

## License

MIT. See [LICENSE](LICENSE).
