# Example: TLH scan

```
User: what's harvestable in personal?
Claude: [calls trade-guard.scan_tlh({tax_entity: "personal", threshold_usd: 500})]
Candidates (wash-sale-clean, sorted by loss size):
1. AAPL — $2,000 unrealized loss, 100 sh in personal-fid
2. QQQ — $800 unrealized loss, 10 sh in personal-fid

User: harvest AAPL, buy SPY afterward
Claude: caveat: SPY isn't substantially identical to AAPL — fine. Proposing:

PROPOSAL — PERSONAL-FID
1. SELL 100 AAPL @ market
   Unrealized loss: $2,000 (harvestable) | Wash-sale: clean
   Caps: PASS

User: do it
Claude: [mleg/equity_force_place → hook PASS → filled → vault updated]

User: now buy 100 SPY
Claude:
PROPOSAL — PERSONAL-FID
1. BUY 100 SPY @ market (~$480 = $48,000)
   Wash-sale on SPY: clean | Caps: PASS

User: do it
Claude: [force_place → hook PASS → filled → vault updated]
```
