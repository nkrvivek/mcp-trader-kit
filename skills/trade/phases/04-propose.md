# Phase 4 — PROPOSE (assemble + risk-check)

**Inputs:** positions, regime, catalyst_map, earnings_map, event_map, inst_holdings_map
**Outputs:** ranked proposal list

## Step 1: Short-option roll screen (if any short legs held)

For each short-option position w/ DTE ≤30 OR delta ≥0.40 OR earnings ≤expiry:

```
mcp__traderkit__calc_roll(
  ticker="<T>",
  current_occ="<OCC>",
  current_mark=<mark>,
  spot=<spot>,
  min_net_credit=0
)
```

Top 2 rolls → `roll_candidates[]` (tagged `[ROLL]`).

## Step 2: New-entry screen

```
mcp__traderkit__screen_options(
  tickers=<universe>,
  structures=["cash_secured_put", "covered_call", "put_credit_spread"],
  filters={
    ivr_min: 30,
    delta_range: [0.15, 0.35],
    dte_range: [21, 60],
    min_credit: 0.25,
    min_oi: 100
  }
)
```

Output → `new_candidates[]`.

## Step 3: Catalyst tag derivation

For each candidate ticker, compute tags from Phase 3 maps:

| Condition | Tag | Signal boost |
|---|---|---|
| Fresh SC 13D (≤60d) from KNOWN_ACTIVISTS | `[ACTIVIST-CATALYST]` | +0.5 |
| SC 13D/A w/ share increase | `[ACTIVIST-ACCUMULATING]` | +0.3 |
| ≥3 KNOWN_FUNDS accumulating | `[SMART-MONEY-ACCUMULATING]` | +0.25 |
| ≥3 KNOWN_FUNDS trimming | `[SMART-MONEY-DISTRIBUTING]` | −0.25 |
| Earnings ≤45d AND short-premium structure | `[EARN-BLACKOUT]` | auto-defer |

Conflict rules:
- Fresh 13D overrides DISTRIBUTING on structure choice
- EARN-BLACKOUT always blocks short-premium regardless of activist tailwind

## Step 4: Signal rank

```
mcp__traderkit__signal_rank(
  signals=<candidates-with-tags>,
  regime_tier="<tier>"
)
```

Deduplicates + composite scores + multi-source boost.

## Step 5: Thesis fit (if user has theses in vault)

For each top candidate:

```
mcp__traderkit__thesis_fit(
  ticker="<T>",
  structure="<s>",
  theses=<loaded-from-vault>
)
```

Flag IN_THESIS / PARTIAL / OFF_THESIS / NO_THESIS_REF.

## Step 6: Propose (sizing + cap check)

Per candidate (top N from signal_rank):

```
mcp__traderkit__propose_trade(
  ticker="<T>",
  price=<spot>,
  structure="<s>",
  profile="<name>",
  current_concentration_pct=<pct>,
  regime_tier="<tier>",
  thesis_ref="<optional>",
  signal_summary="<from-tags>"
)
```

Returns sized proposal w/ sizing trace + cap-enforcement decision.

## Step 7a: Plain-English payoff (demystify options)

For every option structure candidate, call `explain_payoff` before emitting to user. Options-apprehensive traders need plain-English narration of what happens under each scenario, not Greeks.

```
mcp__traderkit__explain_payoff(
  ticker="<T>",
  structure="<covered_call|cash_secured_put|put_credit_spread|call_credit_spread>",
  spot=<spot>,
  strike=<strike>,                  # for CC/CSP
  short_strike=<short>,              # for spreads
  long_strike=<long>,                # for spreads
  premium=<net-credit>,
  contracts=<N>,
  dte=<days>,
  expiry="<YYYY-MM-DD>",
  cost_basis=<basis>                 # for CC
)
```

Returns `{ narrative[], scenarios[], breakeven, max_profit_usd, max_loss_usd }`. Use these strings verbatim in the Payoff row below.

## Step 7b: Format + emit

```
#### Proposal <n> | [CANDIDATE]<tags> | <ticker> <structure> | <broker>
- Thesis:     <thesis_ref> — <IN_THESIS|PARTIAL|OFF_THESIS>
- Tier:       <tier> (cap <cap>%, current <pct>%)
- Signal:     <summary>
- Fundamentals: DCF $<dcf> vs spot $<spot> · Target $<target> · Earn <date> <time>
- Structure:  <human-label>
- Size:       $<size> (<pct>% NAV) · trace: "<formula>"
- Payoff:     <narrative[0]>
              ✓ <scenarios[0].condition> → <scenarios[0].outcome>
              ✗ <scenarios[-1].condition> → <scenarios[-1].outcome>
              Breakeven: $<breakeven> · Max profit: $<max_profit_usd> · Max loss: $<max_loss_usd|∞>
- Guardrails: ✅ notional $<size> ≤ cap $<max_order_notional> · concentration <pct>% ≤ tier cap <cap>% · regime <tier>·<allow|warn> · POP ~<pct>%
- Exit:       <exit-plan>
- Risk:       <risk-note>
- Status:     [ ] pending
```

**Guardrails row format** — pull from check_trade + check_concentration + regime_gate results. Each check rendered as `<metric> <value> <operator> <threshold>` so user can verify arithmetic at a glance. ✅ only if ALL pass; downgrade to ⚠️ on any warn; ❌ on any reject (and proposal should not reach user).

## Step 8: Gate each (interactive mode)

Before showing to user:

```
mcp__traderkit__check_trade(
  profile="<name>",
  ticker="<T>",
  action="<a>",
  structure="<s>",
  notional_usd=<size>,
  tax_entity="<te>"
)
```

Reject proposals that fail hard gates. Surface warnings.

## Mode branching

- `--mode interactive` → sequential approve-execute (one at a time via SnapTrade trade MCP)
- `--mode dry-run` → skip approval; all proposals written to session doc
- `--mode scheduled` → write session doc, send optional notification

## Emit

```
Proposals ready: <n> candidates · <m> no-trade
1. [CANDIDATE][ACTIVIST-CATALYST] <ticker> covered_call $<size> — <thesis>
2. [ROLL] <ticker> <cur>→<new> +$<credit>/contract
[NO-TRADE] <ticker> — <reason>
```
