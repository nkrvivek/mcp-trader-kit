# Phase 5 — PERSIST (session doc + summary)

**Inputs:** all phase outputs, executed orders
**Outputs:** session doc at `$TRADERKIT_VAULT/sessions/<YYYY-MM-DD>/<profile>.md` (if vault configured)

## Step 1: Format session sections

```
mcp__traderkit__session_write(
  action="format_executed",
  executed=<executed-orders>
)
```

```
mcp__traderkit__session_write(
  action="format_deferred",
  deferred=<deferred-proposals>
)
```

```
mcp__traderkit__session_write(
  action="format_no_trade",
  no_trades=<no-trades-with-reasons>
)
```

```
mcp__traderkit__session_write(
  action="format_session_index_row",
  session_id="<id>",
  profile="<name>",
  nav=<nav>,
  regime=<tier>,
  executed_count=<n>,
  deferred_count=<m>
)
```

## Step 2: Write vault (if `TRADERKIT_VAULT` set)

```bash
mkdir -p "$TRADERKIT_VAULT/sessions/$(date +%Y-%m-%d)"
```

Compose session doc from:
- Frontmatter (session-id, profile, date, nav, regime, mode)
- Executed orders table
- Deferred proposals list
- No-trade list
- Portfolio snapshot (positions + concentration)

Write to `$TRADERKIT_VAULT/sessions/<date>/<profile>.md`.

Append session-index row to `$TRADERKIT_VAULT/sessions/index.md` (create if missing).

## Step 3: Optional — memory write

If user has memory MCP configured:

```
mcp__memory__create_entities(
  entities=[
    { name: "<session-id>", entityType: "TradingSession", observations: [...] },
    { name: "<ticker>-<date>", entityType: "Trade", observations: [...] }
  ]
)
```

Skip silently if memory MCP not configured.

## Step 4: End-of-run summary

```
[OK] /trade <profile> complete
  Mode:      <mode>
  Session:   <id>
  NAV:       $<nav>  (δ $<delta> since <last>)
  Regime:    <tier> · size ×<mult>
  Proposals: <n> · <m> no-trade
  Executed:  <x>
  Deferred:  <y>
  Doc:       <path-if-vault>
  Replay:    /trade <profile> --replay <session-id>   ← future
```

## Failure modes

- Vault unreachable → skip write; emit `[DEGRADED] vault offline; session not persisted`
- Session doc already exists → append, don't overwrite
- Memory MCP missing → silently skip
