# Phase 1 — BOOT (profile + regime)

**Inputs:** profile name from `/trade <profile>` arg
**Outputs:** context pack, regime tier, discovery scope

## Steps

### 1. Load profile

```
mcp__traderkit__set_profile(profile="<name>")
```

Then:

```
mcp__traderkit__list_profiles()
```

Confirm caps + account_id load correctly. If profile missing, error: "Run ./scripts/setup.sh to create `~/.traderkit/profiles/<name>.md`".

### 2. Optional: read vault regime

If `TRADERKIT_VAULT` set AND file `$TRADERKIT_VAULT/regime.md` exists, read it. Otherwise skip — regime_gate tool defaults to CLEAR.

Expected format (simple markdown):
```
---
tier: CLEAR|CAUTION|DEFENSIVE|HALT
mqs: 72
cri: 0.28
vcg: 1.4
---
```

Parse frontmatter; fall back to `tier: CLEAR` if unparseable.

### 3. Evaluate regime gate

```
mcp__traderkit__regime_gate(
  tier="<tier>",
  action="BUY_TO_OPEN",
  structure="directional_long",
  proposed_notional_usd=0
)
```

Capture:
- `size_multiplier`
- `blocked_actions`
- `preferred_structures`

### 4. Derive discovery scope

| Tier | Scope |
|---|---|
| HALT | skip Phase 3 |
| DEFENSIVE | held-only (top 5 positions) |
| CAUTION | held + top 3 watchlist |
| CLEAR | full (up to 15 tickers) |

Override: `--force-fresh` or `--trigger pre-open` → CLEAR scope.

### 5. Emit

```
Boot: <profile> · <tier> · NAV $<nav-from-profile-or-last-session> · regime size ×<multiplier>
Discovery: <scope> (<n> tickers in Phase 3)
```

## Failure modes

- Profile not found → exit with `./scripts/setup.sh` hint
- Regime tool unreachable → default CLEAR, `[DEGRADED] regime_gate offline`
- Vault path invalid → skip regime file read, continue
