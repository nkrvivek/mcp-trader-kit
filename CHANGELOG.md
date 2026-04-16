# Changelog

## [0.1.0] — 2026-04-14

### trade-guard-mcp
- Initial release.
- Tools: `check_trade`, `check_wash_sale`, `scan_tlh`, `list_profiles`, `set_profile`.
- Gates: caps (notional, single-name %, forbidden tools + leg shapes), wash-sale (±30d, tax_entity pool, options-on-underlying).
- Credential redaction on tool responses.

### traderkit (repo)
- `setup.sh`, `doctor.sh`, `refresh.sh`, `pre-tool-use.js`.
- Templates: CLAUDE.md, profiles, vault (Obsidian-style wiki/trading/...).
- Docs: brokerages, UW, TradeStation, EXA, tax-entity, risk-gates, proposal-ux.
- Examples: Bildof CC session, TLH walkthrough, morning regime check.
