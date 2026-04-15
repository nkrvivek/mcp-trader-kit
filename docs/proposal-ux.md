# Proposal UX

Before emitting a destructive MCP tool, the model renders:

```
PROPOSAL — BILDOF
1. SELL_TO_OPEN 5x AAPL 2026-06 P150 @ $2.40 credit
   Notional (max loss): $72,600 | Wash-sale: clean
   Caps: notional $5k limit — CAP VIOLATION
2. SELL_TO_OPEN 1x AAPL 2026-06 P150 @ $2.40 credit
   Notional (max loss): $14,520 | Wash-sale: clean
   Caps: notional $5k limit — CAP VIOLATION
```

Natural-language approvals the model understands:
- "do #1", "go with 2", "place the first one"
- "skip", "cancel", "never mind"
- "change qty to 1", "try again at $2.50"
- "what's the max loss on 2?"

Only after an explicit approval referring to a specific numbered option does the model emit the actual tool call. The PreToolUse hook still runs on that call.
