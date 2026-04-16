# Tax entity pooling

Wash-sale aggregation scope is controlled by the `tax_entity` field in each profile.

## Values
- `personal` — all your personal taxable and IRA accounts. (IRS counts IRAs for wash-sale purposes.)
- `llc-bildof`, `llc-innocore` — LLC partnership files its own tax return, separate from your personal return.

Only profiles with the **same** `tax_entity` are pooled. A loss in Fidelity (personal) can wash against a buy in Robinhood (personal) but NOT against Bildof LLC.

## Why option-on-underlying counts
IRS treats options on the same underlying as "substantially identical." traderkit's wash-sale check flags both: `AAPL` stock ↔ `AAPL C150` option.

## ETF-of-same-index
Debated by IRS guidance. Not currently flagged. If you want this, manually override via the activities feed.
