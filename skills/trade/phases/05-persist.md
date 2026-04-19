# Phase 5 — PERSIST (session doc + summary)

**Inputs:** all phase outputs, executed orders
**Outputs:**
- ALWAYS: local session state at `$TRADERKIT_HOME/sessions/<YYYY-MM-DD>/<profile>-<mode>-<HHMMSS>.{json,md}` (fallback `~/.traderkit/sessions/...`)
- IF vault configured: mirror at `$TRADERKIT_VAULT/sessions/<YYYY-MM-DD>/<profile>.md`

Every run — including `--mode dry-run` — MUST call `session_write action=save` so the next run can start from last-known-good state without a vault.

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

## Step 2: Save local session state (MANDATORY, every run)

```
mcp__traderkit__session_write(
  action="save",
  profile="<name>",
  mode="<interactive|dry-run|scheduled>",
  date="<YYYY-MM-DD>",
  nav=<nav>,
  regime_tier="<tier>",
  executed=<executed-orders>,
  deferred=<deferred-proposals>,
  no_trades=<no-trades-with-reasons>,
  markdown_body="<full-formatted-session-doc-if-composed>",
  payload={ signals: [...], catalysts: {...}, regime: {...} }
)
```

Returns `{ session_id, json_path, md_path, local_root }`. Surface `json_path` in end-of-run summary so user can replay/inspect.

## Step 3: Write vault (if `TRADERKIT_VAULT` set)

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

## Step 4: Optional — memory write

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

## Step 5: End-of-run summary

```
[OK] /trade <profile> complete
  Mode:      <mode>
  Session:   <id>
  NAV:       $<nav>  (δ $<delta> since <last>)
  Regime:    <tier> · size ×<mult>
  Proposals: <n> · <m> no-trade
  Executed:  <x>
  Deferred:  <y>
  Local:     <json_path>          ← always
  Doc:       <path-if-vault>
  Replay:    /trade <profile> --replay <session-id>   ← future
```

## Failure modes

- **Local save failure** → HARD error (don't continue silently); surface path + OS error. Local persistence is a hard requirement.
- Vault unreachable → skip vault mirror; emit `[DEGRADED] vault offline; local session still persisted at <json_path>`
- Session doc already exists → append, don't overwrite
- Memory MCP missing → silently skip
