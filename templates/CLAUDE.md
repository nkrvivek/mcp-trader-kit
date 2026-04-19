# traderkit — session rules

Auto-loads at every Claude Code session start inside this vault.

## 1. Always-load docs (read FIRST, every session)
1. `wiki/trading/dashboard.md` — top-of-mind summary.
2. `wiki/trading/regime.md` — market regime + mode.
3. `wiki/trading/risk-signals.md` — CRI + VCG readings.
4. `wiki/trading/portfolio-master.md` — cross-broker aggregate.
5. `wiki/trading/theses/index.md` — active theses.
6. `wiki/trading/open-questions.md` — top 3 items surfaced as prompts.

## 2. Staged-proposal convention (MANDATORY before destructive tools)
Before calling any destructive MCP tool (SnapTrade `equity_force_place`, `equity_confirm`, `mleg_place`, `cancel_order`; TradeStation `place_order`/`cancel_order`), render a numbered proposal block:

```
PROPOSAL — <PROFILE_NAME>
1. <action summary>
   Notional: $<x> | Max loss: $<y> | Wash-sale: <status>
   Caps: <pass|violation-detail>
2. <alternative>
...
```

Wait for natural-language approval ("do #1", "skip", "change qty", "what's max loss on #2"). Only emit the destructive tool call after the user has approved a specific numbered option.

The PreToolUse hook enforces hard rules regardless — proposals are for visibility.

## 3. Active profile
The active profile lives in `~/.traderkit/.session.json`. To switch mid-session, call `traderkit.set_profile(name)`. Every destructive call re-reads the active profile — no caching.

On session start, ask "which profile?" if none is set. Never emit a destructive tool without an active profile.

## 4. Auto-persist rule
Persist durable state to the vault without asking:
- New trade decisions → `wiki/trading/trades/YYYY-MM-DD.md` (append-only).
- Thesis updates → `wiki/trading/theses/<slug>.md` (respects `agent_writeable` flag).
- Regime shifts → `wiki/trading/regime.md`.
- Session summary at turn-end → `wiki/trading/sessions/<id>.md`.

Do not ask "want me to persist this?" — just do it.

## 5. Data freshness
If any dashboard figure is >4h stale OR user asks for "refresh":
```
check_status
list_accounts
get_holdings
```
Then update `portfolio-master.md` + `dashboard.md`.

## 6. Rules
- All portfolio figures MUST trace to a source via wikilink.
- Dates ISO `YYYY-MM-DD`. Currency `$1,234.56`.
- Append-only: trade logs, open-questions resolutions, thesis revisions.
- Never disable the PreToolUse hook.
- Before any destructive tool: (a) confirm profile (b) render proposal (c) wait for explicit approval.
