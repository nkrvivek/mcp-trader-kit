# Phase 2 — REFRESH (broker data)

**Inputs:** profile, regime tier
**Outputs:** NAV, positions, delta since last-session

## Primary source — SnapTrade

Run in parallel:

```
mcp__snaptrade__snaptrade_check_status()
mcp__snaptrade__snaptrade_list_accounts()
mcp__snaptrade__snaptrade_get_balance(account_id="<from-profile>")
mcp__snaptrade__snaptrade_get_positions(account_id="<from-profile>")
```

Capture:
- total_equity, cash_balance, buying_power
- positions[] with { symbol, quantity, market_value, unrealized_pl, cost_basis }

## Optional — TradeStation (if configured)

Only if profile `broker: tradestation` OR user has TS MCP enabled:

```
get-balances-summary()
get-positions-details(accounts="<ts-account-id>")
```

Merge into unified positions list.

## Compute

```
mcp__traderkit__check_concentration(
  positions=<positions>,
  total_equity=<nav>,
  profile="<name>"
)
```

Flags: HEADROOM | AT-CAP | NEAR-CAP | OVER-CAP per position + HHI.

```
mcp__traderkit__classify_holding(
  positions=<positions>,
  theses=[],  // empty if no theses
  thresholds={ core: 5, opportunistic: 2.5, speculative: 1 }
)
```

Tags each: CORE | OPPORTUNISTIC | SPECULATIVE | PURE_SPECULATIVE.

## Freshness

If last session doc in vault <4h old AND no `--force-fresh`, skip full refresh; reuse cached NAV.

## Emit

```
Data: NAV $<nav> · δ $<delta> since <last-session-time> · <n-positions> positions
Concentration: <n-at-cap> AT-CAP · HHI <score>
  OVER-CAP: <ticker1> (<pct>% vs <cap>%), <ticker2> (...)   ← if any
```

## Failure modes

- SnapTrade unreachable → `[DEGRADED] snaptrade offline · using last cached snapshot`
- No profile account_id → exit "set account_id in profile"
- Position symbol normalization fails → continue, flag individual positions
