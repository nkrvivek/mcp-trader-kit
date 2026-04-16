# TradeStation

TradeStation supplies its own MCP server (install separately). Typical env:

- `TS_CLIENT_ID`, `TS_CLIENT_SECRET`, `TS_REFRESH_TOKEN`
- Standard tools: quotes, option chains, place/cancel orders, account balances.

Register under `mcpServers.tradestation` in `.claude/settings.json`. The traderkit hook matcher does NOT intercept TradeStation by default — add `mcp__tradestation__place_order` to the matcher if you use TS write tools.
