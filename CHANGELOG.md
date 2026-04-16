# Changelog

## [0.5.0] — 2026-04-16

### traderkit
- New tools: `trading_calendar`, `performance_metrics`, `thesis_fit`, `session_write`, `broker_route`.
- `trading_calendar`: NYSE calendar with 10 holidays + Good Friday, 5 actions (is_trading_day, next/prev, last-of-month, count-between).
- `performance_metrics`: Sharpe, Sortino, max drawdown, Calmar ratio, win rate from daily returns series.
- `thesis_fit`: IN_THESIS/PARTIAL/OFF_THESIS/NO_THESIS_REF scoring with single + batch modes.
- `session_write`: markdown formatters for session docs (executed table, deferred list, no-trade log, index row).
- `broker_route`: SNAPTRADE/TRADESTATION/MANUAL/DEFERRED routing classification.
- Server version updated to 0.5.0, name to `traderkit`.
- README: updated tool count to 17, added documentation for all new tools.
- README: fixed SnapTrade env vars to show "For wash-sale + TLH" (was "For wash-sale").
- 135 tests passing.

## [0.4.0] — 2026-04-16

### traderkit
- New tools: `signal_rank`, `classify_holding`.
- `signal_rank`: multi-source confidence boosting, dedup by (ticker, source), direction voting.
- `classify_holding`: 5-tier holding classification (CORE/OPPORTUNISTIC/SPECULATIVE/PURE_SPECULATIVE/UNCLASSIFIED).
- Enhanced PreToolUse hook: chains `check_trade` + `regime_gate` (when regime ≠ CLEAR).
- Security: removed hardcoded LLC entity names from schema — `tax_entity` is now a free kebab-case string.
- Security: genericized LLC template entity names.

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
