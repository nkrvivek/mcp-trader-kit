# Changelog

## [0.3.0] — 2026-04-16

### traderkit
- New tools: `propose_trade`, `track_tax`, `trigger_check`.
- `propose_trade`: headroom-based sizing with regime multiplier, cap enforcement, concentration blocking.
- `track_tax`: STCG/LTCG separation, configurable rates, wash-sale tracking, per-trade breakdown.
- `trigger_check`: NAV move, regime shift, and concentration breach detection with severity levels.

## [0.2.0] — 2026-04-16

### traderkit
- New tools: `scan_tlh`, `check_concentration`, `regime_gate`.
- `scan_tlh`: wired existing TLH scanner into MCP tool list.
- `check_concentration`: portfolio concentration labels (HEADROOM/NEAR-CAP/AT-CAP/OVER-CAP) + HHI.
- `regime_gate`: 4-tier market regime sizing (CLEAR/CAUTION/DEFENSIVE/HALT) with action blocking.

## [0.1.0] — 2026-04-14

### traderkit
- Initial release.
- Tools: `check_trade`, `check_wash_sale`, `scan_tlh`, `list_profiles`, `set_profile`.
- Gates: caps (notional, single-name %, forbidden tools + leg shapes), wash-sale (±30d, tax_entity pool, options-on-underlying).
- Credential redaction on tool responses.

### traderkit (repo)
- `setup.sh`, `doctor.sh`, `refresh.sh`, `pre-tool-use.js`.
- Templates: CLAUDE.md, profiles, vault (Obsidian-style wiki/trading/...).
- Docs: brokerages, UW, TradeStation, EXA, tax-entity, risk-gates, proposal-ux.
- Examples: Bildof CC session, TLH walkthrough, morning regime check.
