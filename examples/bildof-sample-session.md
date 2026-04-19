# Example: Bildof session — open a CC ladder

```
User: switch to bildof
Claude: active profile set to bildof (LLC partnership, $5k notional cap, no naked options).

User: current bildof positions
Claude: [calls get_positions] ... summarizes.

User: sell an AAPL 2026-06 $200 covered call against the 100 shares
Claude:
PROPOSAL — BILDOF
1. SELL_TO_OPEN 1x AAPL 2026-06 C200 @ $3.50 credit
   Notional (collateral-covered): $0 cash risk | Wash-sale: clean
   Caps: covered; not cash-gated — PASS

User: do 1
Claude: [calls mleg_place → hook runs check_trade → PASS → broker returns brokerage_order_id 12345]
Recorded to wiki/trading/trades/2026-04-14.md + wiki/trading/bildof/log.md.
```
