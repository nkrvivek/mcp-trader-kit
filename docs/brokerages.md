# Supported Brokerages (via SnapTrade)

traderkit inherits brokerage support from SnapTrade. Tested:

| Broker | Read | Write | Notes |
|---|---|---|---|
| Fidelity (incl. BrokerageLink) | ✅ | ✅ | Equities + options |
| E-Trade | ✅ | ✅ | Partnership/LLC (`INVCLUB_LLC_PARTNERSHIP`) supported via `connection_type=trade` OAuth |
| Robinhood | ✅ | ❌ | SnapTrade code 1063 "does not support trading" |
| IBKR | ✅ | ✅ | Newly live in SnapTrade |
| Schwab | ✅ | ✅ | Standard |
| TradeStation | — | — | Separate MCP (see `tradestation.md`) |
| Ally | ❌ | ❌ | No programmatic path — manual screenshots |
| Morgan Stanley | ❌ | ❌ | No programmatic path |

## Known limitations
- SnapTrade impact endpoints hardcode RTH (error code 1019 "Outside market hours"). Extended-hours requires `equity_force_place` with `trading_session=EXTENDED`.
- Rate limit: 250 req/min (free tier).
- Errors surface via `SnaptradeError.responseBody` — downstream MCPs pass through verbatim.
