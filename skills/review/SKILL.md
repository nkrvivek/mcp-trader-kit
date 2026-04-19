---
name: review
description: Retrospective analytics for a traderkit profile — monthly/quarterly/YTD performance, winner/loser attribution, thesis-fit analysis. Invoked via /review <profile> <scope>.
---

# /review — traderkit retrospective

Lightweight retrospective using traderkit tools + session docs written by `/trade`.

## Usage

```
/review <profile> <scope> [--ticker T] [--thesis name] [--since YYYY-MM-DD]
```

- `<scope>` ∈ {`monthly`, `quarterly`, `ytd`, `ad-hoc`}
- Default range: last 30d (monthly), 90d (quarterly), YTD from Jan 1, all (ad-hoc)

## Steps

### 1. Load sessions from vault

If `TRADERKIT_VAULT` set, glob `$TRADERKIT_VAULT/sessions/*/<profile>.md` within date range. Parse frontmatter + executed/deferred blocks.

If no vault: error "set TRADERKIT_VAULT and run /trade at least once first".

### 2. Aggregate performance

```
mcp__traderkit__performance_metrics(
  returns=<daily-returns-from-sessions>,
  periods_per_year=252,
  risk_free_rate=0.05
)
```

Returns Sharpe, Sortino, max drawdown, Calmar, win rate.

### 3. Winner/loser attribution

Rank closed positions by realized P&L. Group by:
- Ticker
- Thesis (if session docs tagged)
- Structure (stock / CC / CSP / PCS / etc.)

### 4. Thesis fit review

For each closed trade w/ thesis_ref:

```
mcp__traderkit__thesis_fit(
  ticker="<T>",
  structure="<s>",
  theses=<loaded-from-vault>,
  mode="batch"
)
```

Flag thesis drift (IN_THESIS at entry → OFF_THESIS at exit).

### 5. Tax exposure

```
mcp__traderkit__track_tax(
  realized_trades=<from-sessions>,
  stcg_rate=0.358,
  ltcg_rate=0.188
)
```

Surface reserves required + per-trade breakdown.

### 6. Write review doc

If vault configured: write to `$TRADERKIT_VAULT/reviews/<scope>-<date>.md`.

## Emit

```
Review: <scope> · <profile> · <date-range>
  Trades:     <n-open> → <m-closed>
  P&L:        $<realized> realized · $<unrealized> unrealized
  Sharpe:     <s> · Sortino <so> · MaxDD <dd>%
  Winners:    <top 3 tickers>
  Losers:     <bottom 3 tickers>
  Thesis drift: <n-trades> drifted off-thesis
  Tax:        $<stcg> STCG · $<ltcg> LTCG · reserve $<r>
  Doc:        <path-if-vault>
```

## Failure modes

- No sessions in range → "no sessions found; run /trade first"
- performance_metrics min 20 obs — shorter → report only raw P&L
- Missing thesis files → skip thesis_fit, report `[DEGRADED] theses unavailable`
