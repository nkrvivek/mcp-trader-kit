# Unusual Whales (optional)

traderkit does not ship a UW MCP in v0.1. If you have a UW token and want UW endpoints in Claude Code, wire a UW MCP server separately.

## Token tier
Probe your token against ~39 endpoints to see which tier you're on. Full-tier reaches: `darkpool/recent`, `darkpool/{ticker}`, `option-trades/flow-alerts`, `stock/{t}/flow-alerts`, `stock/{t}/greek-exposure`, `stock/{t}/spot-exposures`, `congress/recent-trades`, `insider/transactions`, `market/fda-calendar`, `screener/{analysts,stocks,option-contracts}`, `news/headlines`, `earnings/{premarket,afterhours,{t}}`, `etfs/{t}/holdings`, `alerts/configuration`.

## Cloudflare gate
Requests with the default `python-urllib` User-Agent get Cloudflare code 1010. Always send a browser UA, e.g. `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36`.

## Base URL
`https://api.unusualwhales.com/api/` with `Authorization: Bearer <UW_TOKEN>`.
