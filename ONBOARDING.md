# Onboarding — traderkit in 15 minutes

A step-by-step to go from zero to `/trade main --mode dry-run` running against a real portfolio.

## What you're getting

- AI-assisted trade proposals sized against your profile caps
- Concentration analysis + wash-sale gating + regime-based sizing
- Optional: FMP fundamentals, SEC activist filings, 13F smart-money tracking
- All orders gated by a `PreToolUse` hook — nothing fires without a risk check

## Prerequisites

### Minimum (free, required)

- **macOS / Linux** shell (WSL works on Windows)
- **Node.js 20+** and **npm** — `brew install node` or https://nodejs.org/
- **Claude Code** — `npm install -g @anthropic-ai/claude-code` or via Claude.ai
- **SnapTrade account** — https://dashboard.snaptrade.com/signup
- **At least one linked brokerage**: Fidelity / Robinhood / E-Trade / IBKR / Schwab / Alpaca

### Recommended (free, unlocks 80% of Phase 3)

- **FMP account** — https://site.financialmodelingprep.com/developer/docs (free tier: 250 calls/day)
- **An email address** — used as your SEC EDGAR User-Agent string (SEC fair-use requires a contact email)

### Optional (advanced)

- **Unusual Whales** subscription — https://unusualwhales.com/ (unlocks options screener + max-pain)
- **Finnhub** free tier — https://finnhub.io/ (earnings blackout gating)
- **EXA** API key — https://exa.ai/ (qualitative news catalysts)
- **TradeStation** account — if you prefer TS for options execution

## Step 1: Get SnapTrade credentials

1. Sign up at https://dashboard.snaptrade.com/signup
2. Dashboard → **Credentials** → copy these four values:
   - `SNAPTRADE_CLIENT_ID`
   - `SNAPTRADE_CONSUMER_KEY`
   - `SNAPTRADE_USER_ID` (generate one — any unique string for your account)
   - `SNAPTRADE_USER_SECRET` (generate via the SnapTrade `registerUser` API or dashboard)
3. Dashboard → **Connect broker** → link your brokerage account via the OAuth flow
4. Save the **account UUID** SnapTrade assigns to your linked brokerage — you'll need it for your profile

## Step 2 (optional): Get FMP API key

1. Sign up free at https://site.financialmodelingprep.com/developer/docs
2. Copy the API key from your dashboard → save as `FMP_API_KEY`

## Step 3: Install traderkit

**Zero-env one-liner** (installs Xcode CLT, Homebrew, Node 20, Claude CLI, then runs setup — idempotent, safe to re-run):

```bash
curl -fsSL https://raw.githubusercontent.com/nkrvivek/traderkit/main/scripts/bootstrap.sh | bash
```

Or if Node 20 + Claude CLI are already installed:

```bash
git clone https://github.com/nkrvivek/traderkit
cd traderkit
npm install
./scripts/setup.sh
```

This installs two MCP servers from npm (`traderkit` risk gate + `snaptrade-trade-mcp` unified reads+trading) — no local builds required.

The setup wizard prompts for a **vault path** (where session docs + notes live). Pick any directory — `~/trading-vault` works. It will:

- Create `~/.traderkit/{profiles,scripts,.env}`
- Symlink skills to `~/.claude/skills/{trade,review}`
- Copy vault templates (dashboard, sessions dir, theses dir)
- Copy the `PreToolUse` hook script

## Step 4: Fill in `.env`

```bash
$EDITOR ~/.traderkit/.env
```

Fill at minimum:

```
SNAPTRADE_CLIENT_ID=...
SNAPTRADE_CONSUMER_KEY=...
SNAPTRADE_USER_ID=...
SNAPTRADE_USER_SECRET=...
```

Recommended additions:

```
FMP_API_KEY=...
SEC_USER_AGENT="traderkit-yourname contact: you@example.com"
TRADERKIT_VAULT=/absolute/path/to/vault
```

Optional:

```
UW_TOKEN=...
FINNHUB_API_KEY=...
EXA_API_KEY=...
```

## Step 5: Fill in your profile

```bash
$EDITOR ~/.traderkit/profiles/example-personal.md
# rename to main.md when ready
mv ~/.traderkit/profiles/example-personal.md ~/.traderkit/profiles/main.md
```

Edit the frontmatter — the critical field is `account_id` (the SnapTrade account UUID from Step 1):

```yaml
---
name: main
broker: snaptrade
account_id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
tax_entity: personal
caps:
  max_order_notional: 5000
  max_single_name_pct: 20
  forbidden_leg_shapes: [naked_put, naked_call]
---
```

Set `max_order_notional` + `max_single_name_pct` to levels you're actually comfortable with. These are your guardrails — the skill refuses to propose trades that breach them.

## Step 6: Health check

```bash
bash ./scripts/doctor.sh
```

This verifies:
- `.env` loads
- SnapTrade credentials work (runs `snaptrade_check_status`)
- traderkit MCP tools register
- Skills are symlinked correctly

Fix any ❌ before proceeding.

## Step 7: First dry-run

```bash
cd $TRADERKIT_VAULT
claude
```

In the Claude Code prompt, type:

```
/trade main --mode dry-run
```

You'll see the 5 phases run:

```
Boot: main · CLEAR · NAV $... · regime size ×1.0
Data: NAV $... · δ $... · 12 positions
Discovery: 5 earnings · 2 activist filings
Proposals ready: 3 candidates · 7 no-trade
  1. [CANDIDATE][SMART-MONEY-ACCUMULATING] XYZ covered_call $3,200 — in-thesis
  ...
[OK] /trade main complete — dry-run (no orders placed)
```

No orders fire. Session doc lands in `$TRADERKIT_VAULT/sessions/<YYYY-MM-DD>/main.md`.

## Step 8: Going live

Once dry-run looks sane, switch to interactive mode:

```
/trade main --mode interactive
```

Each proposal is presented one at a time. Type `y` to execute, `n` to skip, `d` to defer, `q` to stop. The `PreToolUse` hook runs `check_trade` + `regime_gate` before every order — if a trade breaches caps or wash-sale, it auto-blocks.

## Step 9 (optional): Monthly review

At month-end:

```
/review main monthly
```

Produces: Sharpe / Sortino / max-drawdown / winners / losers / thesis drift / tax reserves. Writes to `$TRADERKIT_VAULT/reviews/monthly-<date>.md`.

## Troubleshooting

**`SnapTrade credentials rejected`** — re-verify `CONSUMER_KEY` + `USER_SECRET`. `USER_ID` is whatever you picked at registration; `USER_SECRET` comes from the `registerUser` response.

**`no profile found: main`** — profile file must be at `~/.traderkit/profiles/main.md` w/ YAML frontmatter. Check `ls ~/.traderkit/profiles/`.

**`FMP 402`** — you hit the free-tier 250 calls/day limit, or the endpoint requires paid tier. Skill degrades gracefully — earnings map just goes empty.

**`SEC_USER_AGENT not set` warning** — set it in `.env`. SEC fair-use requires a contact email in the UA string; without it, SEC may rate-limit your IP.

**`/trade` command not found in Claude Code** — skills aren't symlinked. Re-run `./scripts/setup.sh` or manually: `ln -s $PWD/skills/trade ~/.claude/skills/trade`.

**Orders get blocked by hook** — read the hook output; it tells you which cap was breached. Adjust your profile caps if intentional, or take the hint.

## What this is NOT

- Not a signal generator — you bring the ideas, it gates + sizes them
- Not financial advice — every trade is your decision
- Not a backtest engine — it runs against live accounts only
- Not a replacement for your broker's UI — it proposes + gates; you approve

## Next steps

- Add more profiles (one per tax entity): `~/.traderkit/profiles/{llc,ira}.md`
- Explore other tools: `/` in Claude Code → see available slash commands
- Read `mcp-servers/traderkit/README.md` for details on every tool
- Fork skills at `skills/trade/phases/*.md` to customize the pipeline

## Support

Issues: https://github.com/nkrvivek/traderkit/issues
