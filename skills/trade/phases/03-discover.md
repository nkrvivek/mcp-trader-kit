# Phase 3 — DISCOVER (catalysts + smart-money, regime-gated)

**Inputs:** universe from Phase 1 scope, regime tier
**Outputs:** catalyst_map, earnings_map, event_map (activist), inst_holdings_map

Skip entirely if regime is HALT (no `--force-fresh`).

## Step 1: FMP fundamentals + earnings (batch)

Per universe ticker (cap 10):

```
mcp__traderkit__fmp_fundamentals(ticker="<T>", want=["quote","dcf","target","earnings"])
```

Collect `next_earnings_date`, `timing` (bmo/amc), `eps_estimated`. Flag `earnings_blackout=true` when next earnings ≤45 days from today.

Skip if `FMP_API_KEY` missing — emit `[DEGRADED] FMP key missing, earnings map empty`.

## Step 2: Activist filings (per session, cheap)

Per universe ticker:

```
mcp__traderkit__track_activists(
  mode="by_ticker",
  ticker="<T>",
  days_back=90,
  forms=["SC 13D", "SC 13D/A"],
  top=5
)
```

Build `event_map[ticker] = [{ form, filer_names, filing_date, doc_url }]`.

Fresh 13D from KNOWN_ACTIVISTS → tag `[ACTIVIST-CATALYST]` in Phase 4.

Skip if `SEC_USER_AGENT` unset — emit `[DEGRADED] SEC UA missing` (will warn via stderr anyway).

## Step 3: 13F smart-money (monthly only)

Only run on `--trigger monthly` OR `--force-fresh`. 13F is quarterly w/ 45d lag — no intraday value.

Per held position:

```
mcp__traderkit__inst_holdings(
  mode="by_ticker",
  ticker="<T>",
  top=10
)
```

Capture `interpretation` (accumulating/distributing/balanced) + any `notable_matches` (Berkshire, BlackRock, etc.) into `inst_holdings_map[ticker]`.

Also for each curated fund:

```
mcp__traderkit__inst_holdings(mode="by_fund", fund="berkshire", top=15)
mcp__traderkit__inst_holdings(mode="by_fund", fund="pershing",  top=15)
mcp__traderkit__inst_holdings(mode="by_fund", fund="baupost",   top=15)
```

Surface top 3 new positions per fund → optional vault write at `$TRADERKIT_VAULT/superinvestor-scan/<YYYY-MM>.md`.

## Step 4: Qualitative catalysts (optional, EXA)

If EXA MCP configured AND regime ≠ HALT:

```
mcp__exa__web_search_exa(
  query="<TICKER> news catalyst last 7 days",
  num_results=3,
  start_published_date="<7d-ago-iso>"
)
```

Regime-gated budget:
- DEFENSIVE: max 5 calls
- CAUTION: max 8
- CLEAR: max 20

Parse into `catalyst_map[ticker] = [{ headline, sentiment, date, url }]`.

Skip if EXA not configured — catalyst_map stays empty; Phase 4 still functions on fundamentals + earnings + events.

## Emit

```
Discovery: <n_fmp> earnings · <n_events> activist filings · <n_13f> 13F signals · <n_catalysts> EXA catalysts
  Earnings (next 21d): <ticker> <date> <time> est $<eps> · ...
  Activist (90d): <ticker> SC 13D <filer> <date>         ← if any
  Smart-money: <ticker> accumulating (<n> KNOWN_FUNDS building) ← if any
[DEGRADED] <source>: <error>    ← per source that failed
```
