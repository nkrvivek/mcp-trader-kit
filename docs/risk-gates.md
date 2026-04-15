# Risk gates

Enforcement lives in three layers:

1. **CLAUDE.md convention** — model must render a numbered proposal + wait for natural-language approval. Visibility.
2. **PreToolUse hook** — fires on destructive tool calls, invokes `trade-guard.check_trade`, blocks on fail. Hard enforcement.
3. **trade-guard-mcp** — caps (notional, single-name %, forbidden tools/legs) + wash-sale (±30d, tax_entity pool).

## Fail-closed default
If the hook cannot reach trade-guard-mcp or the active profile is unset, the hook blocks by default. Override with `MCP_TRADER_KIT_FAIL_OPEN=true` (not recommended).

## Forbidden leg shapes
Defined in profile YAML. trade-guard inspects args passed to `mleg_place` and rejects if any leg matches a forbidden shape.

## Override path
If a gate blocks a trade you want to make: edit the profile cap, re-run doctor, retry. Gates are configuration, not hardcoded. They fail closed on purpose.
