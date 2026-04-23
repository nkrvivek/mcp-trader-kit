# RFC: combo_fillability + BAG-aware roll/reprice gates

**Status:** proposed · **Created:** 2026-04-23 · **Trigger:** BBAI 2026-04-23 incident (see `obsidian/wiki/trading/execution-playbook#R14`)

## Problem

`calc_roll` and `repricing_check` treat a BAG (multi-leg combo) as if it fills like a single-leg order. Thin-underlying calendar rolls in the last hour don't — market makers ignore them regardless of net price. The 2026-04-23 BBAI $4P Apr-24/May-01 roll reprieced 0.10 → 0.05 → 0.00 → canceled at T-3, forcing assignment.

Signals that were available pre-submit but not surfaced:
- near-leg DTE ≤ 1
- near-leg OI < 2k
- underlying ADV < 5M
- spot within ±10% of near strike
- minutes-to-close < 60

Any two of those → BAG combo will not fill. Correct action is **leg out** (BTC near as single-leg, STO far as single-leg), not "reprice lower."

## Goals

1. Surface a numeric fillability score before BAG orders are placed.
2. Have `repricing_check` recommend `LEG_OUT` on low-fillability BAGs instead of `REPRICE` / `HOLD`.
3. Extend `calc_roll` output with a `leg_out` alternative so the model can propose both paths.
4. Block low-fillability combo rolls via `propose_trade` + `check_trade` gates.

Non-goals: auto-execute leg-outs, ML-based fill prediction, cross-broker venue routing.

## Tool 1 — `combo_fillability` (new)

### Signature

```ts
export const ComboFillabilityArgs = z.object({
  ticker: TickerSchema,
  legs: z.array(z.object({
    action: z.enum(["BUY", "SELL"]),
    right: z.enum(["C", "P"]),
    strike: z.number().positive(),
    expiry: IsoDateSchema,
    ratio: z.number().int().positive().default(1),
  })).min(2),
  net_price: z.number(),                      // credit positive, debit negative
  tif: z.enum(["DAY", "GTC"]).default("DAY"),
  now: z.string().optional(),                 // ISO; defaults to Date.now()
  close_time: z.string().optional(),          // ISO; defaults to today 20:00Z
});

export type ComboFillabilityResult = {
  score: "HIGH" | "MEDIUM" | "LOW";
  numeric_score: number;                      // 0–100
  reasons: string[];                          // human-readable failure modes
  inputs: {
    near_leg: { expiry: string; dte: number; oi: number; bid: number; ask: number };
    far_leg:  { expiry: string; dte: number; oi: number; bid: number; ask: number };
    underlying: { price: number; adv_30d: number; spot_to_near_strike_pct: number };
    minutes_to_close: number;
  };
  suggestion: "SUBMIT" | "REPRICE_MID" | "LEG_OUT" | "CANCEL";
  leg_out_plan?: {
    btc: { action: "BUY"; strike: number; expiry: string; right: "C" | "P"; est_price: number };
    sto: { action: "SELL"; strike: number; expiry: string; right: "C" | "P"; est_price: number };
    est_net: number;
    slippage_vs_combo: number;                // +/− vs current combo net_price
  };
};
```

### Rule logic (v1, no ML)

Score starts at 100; deduct per rule hit.

| Rule | Threshold | Deduction |
|---|---|---|
| Near-leg DTE ≤ 1 | same-day / next-day | −25 |
| Near-leg OI < 2,000 | tight MM book | −20 |
| Underlying ADV < 5M shares | thin tape | −15 |
| Spot within ±10% of near strike | gamma pin risk | −10 |
| Minutes-to-close < 60 | end-of-session | −15 |
| Net price < mid−width (near/far) | MM adverse | −10 |
| Bid/ask width > 20% of mid (either leg) | illiquid | −15 |

Score ranges: HIGH ≥ 70, MEDIUM 40–69, LOW < 40.

Mapping:
- HIGH → `SUBMIT`
- MEDIUM → `REPRICE_MID` (nudge toward combo mid)
- LOW → `LEG_OUT` with concrete plan
- LOW + net < 0 (debit) + minutes_to_close < 30 → `CANCEL`

### Data sources

- `uwOptionChain(ticker, expiry)` for each leg — `bid`, `ask`, `mid`, `open_interest`, `iv`
- `uwStockState(ticker)` — `price`, `avg_volume_30d`
- NYSE calendar (existing `trading_calendar`) — `close_time` for today

### Regression fixture

`test/fixtures/combo-fillability/bbai-2026-04-23.json`:

```json
{
  "ticker": "BBAI",
  "legs": [
    {"action":"BUY","right":"P","strike":4,"expiry":"2026-04-24","ratio":1},
    {"action":"SELL","right":"P","strike":4,"expiry":"2026-05-01","ratio":1}
  ],
  "net_price": 0.05,
  "tif": "DAY",
  "now": "2026-04-23T19:45:00Z",
  "close_time": "2026-04-23T20:00:00Z",
  "_mock": {
    "near": {"dte": 1, "oi": 1342, "bid": 0.29, "ask": 0.30, "mid": 0.295},
    "far":  {"dte": 8, "oi": 1876, "bid": 0.38, "ask": 0.41, "mid": 0.395},
    "underlying": {"price": 3.72, "adv_30d": 3_800_000}
  },
  "_expected": {
    "score": "LOW",
    "numeric_score_min": 0,
    "numeric_score_max": 35,
    "suggestion": "LEG_OUT",
    "leg_out_plan": {
      "btc": {"est_price": 0.30},
      "sto": {"est_price": 0.38},
      "est_net": 0.08
    }
  }
}
```

## Tool 2 — `calc_roll` extension

Add optional `leg_out` field per candidate (additive, no breaking change):

```ts
interface RollCandidate {
  // ...existing fields
  leg_out?: {
    btc_price: number;         // current leg ask
    sto_price: number;         // new leg bid
    est_net: number;
    slippage_vs_combo: number; // est_net − combo_net
    note: string;              // e.g. "at T-60 leg-out preferred; MM book thin"
  };
}
```

Populate when near-leg DTE ≤ 1 OR `combo_fillability.score === "LOW"`. Otherwise omit.

## Tool 3 — `repricing_check` BAG branch

Extend args:

```ts
legs?: Leg[];                  // if provided, treat as BAG
near_leg_dte?: number;
minutes_to_close?: number;
```

When `legs` present AND fillability is LOW:
- `action: "LEG_OUT"` (new enum variant)
- `recommendation: "R14: BAG combo low fillability — cancel + leg out (BTC near @ ask, STO far @ bid)"`

Keep single-leg behavior unchanged.

## Tool 4 — `propose_trade` / `check_trade` gate

For trade shape = `calendar_roll` or `diagonal_roll`:

1. Call `combo_fillability` pre-placement.
2. If `score === "LOW"`: emit warning, set `suggested_structure: "leg_out"`, include `leg_out_plan` in proposal.
3. Model must render both paths in the numbered proposal (per `docs/proposal-ux.md`). User approval then routes to either BAG or two single-leg orders.

No auto-route. R6 (explicit user approval) stands.

## Implementation order

1. `src/tools/combo-fillability.ts` — pure rule engine, mockable UW client, full test coverage.
2. Regression test from BBAI fixture → must return `LOW` + `LEG_OUT`.
3. `calc_roll` — add `leg_out` field population.
4. `repricing_check` — add BAG branch.
5. `propose_trade` / `check_trade` — wire gate, add proposal-UX rendering of leg-out alternative.
6. Register tool in `src/index.ts`; update README tools table.

## What NOT to build

- No auto-execution of leg-out (user approval gate stays).
- No ML / backtest framework — rule-based score is sufficient for v1.
- No per-venue MM routing — IB smart routing handles.
- No new broker-route logic — leg-out is two existing single-leg orders.
- No persistence of fillability scores across sessions — stateless tool.

## Test plan

- Unit: each rule fires independently against synthetic chains.
- Regression: BBAI 2026-04-23 fixture must score LOW.
- Regression: liquid SPX calendar (high OI, ADV) must score HIGH.
- Integration: `repricing_check` with `legs` present returns `LEG_OUT` on low-fillability.

## Cross-references

- `obsidian/wiki/trading/execution-playbook#R13` — use `scripts/ib_order_manage.py` for modify/cancel (not inline ib_insync).
- `obsidian/wiki/trading/execution-playbook#R14` — BAG calendar-roll leg-out rule (this RFC operationalizes).
- `obsidian/wiki/trading/sessions/2026-04-23/personal.md` — incident narrative.
