---
title: mcp-trader-kit — design spec
project: mcp-trader-kit
version: 0.1.0-draft
created: 2026-04-14
updated: 2026-04-14
status: approved (pending final user review)
supersedes: 2026-04-14-clitrader-design.md
tags: [#trading, #mcp, #oss, #setup-pack]
---

# mcp-trader-kit — packaged AI-assisted trading setup

## 1. Purpose

Ship the author's Claude-Code-as-trading-terminal workflow as a cloneable, reproducible OSS setup pack. Not a CLI. Not a framework. A GitHub repo someone runs `./setup.sh` on to get: MCPs wired, risk gates enforced, vault structured, profiles configured.

**Primary user:** the author, then other traders who want a battle-tested Claude-Code trading setup w/o reinventing gates, profiles, vault conventions, or wash-sale checks.
**Distribution:** public GH repo + npm-published MCP servers, MIT, day 1, w/ explicit disclaimer.

## 2. Scope

**In scope (v0.1):**
- Setup script that wires MCPs, writes CLAUDE.md, creates vault, registers Claude Code hooks.
- `trade-guard-mcp`: small MCP server exposing `check_trade`, `check_wash_sale`, `scan_tlh`, `list_profiles`.
- PreToolUse hook that intercepts destructive MCP calls and dispatches to `check_trade`.
- CLAUDE.md template enforcing staged-proposal UX + auto-persist + regime/risk load.
- Markdown profile templates w/ YAML frontmatter (caps, tax_entity, forbidden_tools).
- Vault template mirroring author's `wiki/trading/` structure.
- Docs per integration: SnapTrade brokerages, TradeStation, Unusual Whales, EXA, radon (optional).
- Example transcripts demonstrating Bildof + personal + TLH flows.
- `doctor.sh` health check (MCP reachability, creds validity, vault shape).

**Out of scope (v0.1):**
- Custom REPL / CLI wrapper (that would be `clitrader`, deferred).
- Multi-LLM runtime (user brings their own MCP client — Claude Code default).
- Web UI, mobile, push notifications.
- Day-P&L circuit breaker (v0.2).
- Mandatory thesis-link gate (v0.2).
- Auto-install of brokerage MCPs beyond `npm install` (v0.2).

## 3. Architecture

### 3.1 High-level

```
mcp-trader-kit  (GitHub repo, clone + setup)
├── Install script           — interactive creds, MCP wiring, hook registration
├── trade-guard-mcp          — gate MCP: caps, wash-sale, TLH
├── CLAUDE.md template       — auto-load, proposal convention, auto-persist
├── Profile templates        — markdown w/ YAML frontmatter
├── Vault template           — Obsidian-style trading wiki
├── Claude Code hooks        — PreToolUse gate enforcement
└── Docs + examples          — integration guides, sample transcripts
```

**Runtime at use time:**

```
User's machine
├── Claude Code (or any MCP client)  — REPL, LLM, tool-use loop, session log
├── ~/.mcp-trader-kit/
│   ├── .env                         — secrets (gitignored)
│   ├── profiles/*.md                — user's profiles (copied from templates)
│   └── vault/                       — Obsidian-style trading vault
├── MCP servers (npm-installed):
│   ├── trade-guard-mcp              — gates (this repo)
│   ├── snaptrade-trade-mcp          — write-side (author's v0.1, public)
│   ├── snaptrade-mcp-ts             — read-side (upstream, public)
│   ├── tradestation-mcp             — TS orders + quotes
│   ├── exa-mcp                      — research (required)
│   ├── uw-mcp                       — research (optional)
│   └── radon-mcp-shim               — IBKR direct (optional)
└── Claude Code settings (project-scoped):
    ├── MCP registrations (above)
    └── PreToolUse hook → trade-guard.check_trade
```

**Critical invariant:** every destructive MCP call passes through the PreToolUse hook → `trade-guard.check_trade`. Read-only calls bypass. Bypass path: user explicitly disables hook (documented as not recommended, logged).

### 3.2 `trade-guard-mcp`

Node 20+ MCP server, stdio transport, TS source, built w/ `@modelcontextprotocol/sdk` + `zod` v4. Published to npm.

**Tools:**

- `check_trade(profile: string, tool: string, args: object) → { pass: boolean, reasons: string[], warnings: string[] }`
  - Reads profile YAML at `~/.mcp-trader-kit/profiles/<profile>.md`.
  - Runs caps check (`max_order_notional`, `max_single_name_pct`, `forbidden_tools`, `forbidden_leg_shapes`).
  - Runs wash-sale check internally (calls `check_wash_sale`).
  - Composes single pass/fail w/ reasons.

- `check_wash_sale(ticker: string, action: BUY|SELL, tax_entity: string) → { flagged: boolean, detail: string, window_start: date, window_end: date }`
  - Pulls last 30d activities via the snaptrade-read MCP (same machine, stdio-hosted in the same Claude Code session; trade-guard calls it as a sibling MCP through a client it spawns on first use).
  - Filters to same-`tax_entity` profiles.
  - Detects same-ticker and option-on-same-underlying matches.

- `scan_tlh(tax_entity: string, threshold_usd?: number) → Candidate[]`
  - Returns positions w/ unrealized losses > threshold, excluding names in a wash-sale window.

- `list_profiles() → Profile[]`
  - Returns available profiles (name, broker, tax_entity, caps summary).

**Profile file shape:**
```markdown
---
name: bildof
broker: snaptrade
account_id: <uuid>
tax_entity: llc-bildof
caps:
  max_order_notional: 5000
  max_single_name_pct: 10
  forbidden_tools: []
  forbidden_leg_shapes: [naked_put, naked_call]
vault_link: bildof/log.md
---

# Bildof profile

Human-readable notes about this account's strategy, rules, and history.
Displayed to the model as context.
```

**Wash-sale inter-MCP call:** trade-guard spawns a second MCP client connection to snaptrade-mcp-ts on first wash-sale call; caches activities for 5 min. Documented as a dependency — if snaptrade-mcp-ts is not installed, `check_wash_sale` returns `{ flagged: false, detail: "wash-sale check unavailable — snaptrade-mcp-ts not reachable" }` and logs a warning. Hook still blocks if `require_wash_sale_check: true` in global config.

### 3.3 PreToolUse hook

Claude Code project-scoped settings register a `PreToolUse` hook w/ matcher targeting destructive tools:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__snaptrade-trade__*|mcp__tradestation__place_order|mcp__tradestation__cancel_order",
        "command": "node ~/.mcp-trader-kit/scripts/pre-tool-use.js",
        "description": "Enforce risk gates before destructive trade tools"
      }
    ]
  }
}
```

The hook script reads tool name + args from stdin, reads the active profile (env var `MCP_TRADER_KIT_PROFILE` or session state file at `~/.mcp-trader-kit/.session.json`), calls `trade-guard.check_trade` via a short-lived stdio client, and:

- Pass → exit 0 w/ original input passed through.
- Reject (caps/wash-sale) → exit 2 w/ structured block reason that Claude Code surfaces to the model.
- Warning only → exit 0 w/ a note prepended that shows in the model's context.

Impact endpoints (`equity_impact`, `mleg_impact`) are not matched → bypass the hook. They hit the broker for preview only.

**Profile switch:** documented slash-like convention in CLAUDE.md — user types "switch to bildof" → model writes `MCP_TRADER_KIT_PROFILE=bildof` to `~/.mcp-trader-kit/.session.json` via a `set_profile` tool exposed by trade-guard-mcp.

### 3.4 Staged-proposal UX — convention, not code

CLAUDE.md instructs the model:

> Before emitting any destructive MCP tool call, render a numbered proposal block to the user. Example:
>
> ```
> PROPOSAL — BILDOF
> 1. SELL_TO_OPEN 5x AAPL 2026-06 P150 @ $2.40 credit
>    Notional (max loss): $72,600 | Wash-sale: clean
>    Caps: notional $5k limit — CAP VIOLATION
> 2. SELL_TO_OPEN 1x AAPL 2026-06 P150 @ $2.40 credit
>    Notional (max loss): $14,520 | Wash-sale: clean
>    Caps: notional $5k limit — CAP VIOLATION
> ```
>
> Wait for natural-language approval ("do #1", "skip", "change qty to 1, paper first"). Only emit the destructive tool call after explicit user approval.

The hook still enforces hard rules — proposal is a UX convention, not a substitute for gates. The combination: proposal visibility prevents most misfires; the gate catches the rest.

### 3.5 Vault template

Copies to the user's chosen vault path. Structure:

```
vault/
├── CLAUDE.md                       # project-scoped, auto-loads below
├── wiki/trading/
│   ├── dashboard.md                # top-of-mind summary, user maintains
│   ├── regime.md                   # market regime + trading mode
│   ├── risk-signals.md             # CRI + VCG readings
│   ├── portfolio-master.md         # cross-broker aggregate
│   ├── open-questions.md           # decision queue, append-only
│   ├── theses/
│   │   └── index.md
│   ├── trades/                     # YYYY-MM-DD.md append-only trade logs
│   ├── sessions/                   # per-session human-readable summaries
│   └── scanner-signals.md          # UW/scanner output, if wired
└── index.md                        # wiki index
```

All docs use YAML frontmatter w/ `agent_writeable` flag. Auto-persist rule baked into CLAUDE.md.

### 3.6 Setup script (`scripts/setup.sh`)

Interactive. Steps:

1. Prompt for vault path (default: `./vault`). Create + copy template.
2. Prompt for `~/.mcp-trader-kit/` location (default: `$HOME/.mcp-trader-kit`). Create + copy profiles templates.
3. Prompt for provider creds (SnapTrade, TradeStation, EXA; optional UW, radon). Write to `~/.mcp-trader-kit/.env` (gitignored).
4. Walk user through first profile: name, broker, account_id (or "discover later"), tax_entity, caps.
5. Run `npm install -g` (or `npx` alias) for trade-guard-mcp + the required MCPs.
6. Write Claude Code project settings (`.claude/settings.json` in vault dir) w/ MCP registrations + PreToolUse hook.
7. Run `doctor.sh` — verifies each MCP reachable, each cred valid, vault readable.
8. Print next steps: `cd <vault> && claude`.

All steps idempotent — re-running updates, never destroys.

### 3.7 `doctor.sh`

Health check, no writes. Exits non-zero on any failure. Outputs a table:

```
component             status    detail
--------              ------    ------
trade-guard-mcp       OK        v0.1.0
snaptrade-trade-mcp   OK        v0.1.0, creds valid
snaptrade-mcp-ts      OK        v0.1.0, 5 accounts visible
tradestation-mcp      OK        OAuth token fresh (3d remain)
exa-mcp               OK        api key valid
uw-mcp                SKIP      optional; not installed
radon-mcp-shim        SKIP      optional; not installed
vault                 OK        /Users/.../vault
profiles              OK        2 profiles (bildof, personal)
hook                  OK        PreToolUse registered
```

## 4. Data flow — destructive trade in Claude Code

1. User in Claude Code REPL (launched in `<vault>` dir): "sell 5 AAPL 2026-06 P150 for credit in bildof".
2. Model reads CLAUDE.md-loaded context (dashboard, regime, theses, active profile).
3. Model emits a **numbered proposal** per CLAUDE.md convention (not a tool call yet).
4. User types "do it".
5. Model emits `mcp__snaptrade-trade__mleg_place` tool_use.
6. Claude Code PreToolUse hook fires → runs `node ~/.mcp-trader-kit/scripts/pre-tool-use.js`.
7. Hook script connects stdio to trade-guard-mcp, calls `check_trade({profile: "bildof", tool: "mleg_place", args: {...}})`.
8. trade-guard runs caps + wash-sale → returns `{ pass: false, reasons: ["notional $72,600 > cap $5,000"] }`.
9. Hook exits 2 w/ reason → Claude Code surfaces block to the model.
10. Model explains to user, suggests smaller size.
11. User: "do 1 contract". Model re-proposes, user approves, model re-emits `mleg_place` w/ qty 1 → hook passes → Claude Code dispatches to snaptrade-trade-mcp → broker returns `brokerage_order_id`.
12. Model updates `vault/wiki/trading/trades/YYYY-MM-DD.md` via its filesystem capability (auto-persist rule in CLAUDE.md).

## 5. Error handling

| Class | Handling |
|---|---|
| Gate rejection | Hook exits 2 w/ structured reason → model sees and explains to user |
| Profile missing | Hook warns + defaults to "no profile" which has hardest caps ($0 notional) — effectively blocks |
| snaptrade-read unreachable (wash-sale check) | `check_wash_sale` returns unavailable; hook blocks if `require_wash_sale_check: true`, else warns + passes |
| MCP connect fail | Surfaces to Claude Code normally; `doctor.sh` diagnoses |
| Broker API reject | SnaptradeError.responseBody surfaced verbatim (downstream MCP handles) |
| Hook script crash | Fail-closed by default: non-zero exit blocks. Config flag `fail_open_on_hook_crash: false` |
| Profile parse error | Hook exits 2 w/ reason; doctor.sh catches on install |

## 6. Testing

**Unit (vitest, trade-guard-mcp):**
- `check_trade`: caps (notional, single-name %, forbidden tools, forbidden leg shapes).
- `check_wash_sale`: ±30d boundary, cross-account pool by tax_entity, option-on-same-underlying, LLC-vs-personal isolation.
- `scan_tlh`: candidate scoring, wash-sale exclusion.
- `list_profiles`: parse YAML, validation.

**Integration:**
- Real trade-guard stdio subprocess w/ mocked snaptrade-read MCP → exercise wash-sale end-to-end.
- Hook script: feed synthetic Claude Code PreToolUse JSON on stdin, assert exit codes + reasons.

**E2E (manual):**
- `scripts/test-setup.sh` — runs full setup.sh against a disposable vault + example creds (env vars).
- `scripts/test-doctor.sh` — asserts doctor.sh output matches a golden.
- Live-trade smoke against author's sandbox account — $1 order place + cancel.

**Coverage target:** 80% overall; 100% on gate logic (caps, wash-sale).

## 7. Security / secrets

- `~/.mcp-trader-kit/.env` — gitignored, 0600 perms.
- Setup script validates creds before writing (calls SnapTrade status, EXA ping, etc).
- Never log raw creds. Redaction middleware in trade-guard-mcp (pattern: any substring match against env values → `<REDACTED>`).
- Installer refuses to write creds if vault path is inside a git repo with an unignored `.env`.
- doctor.sh sanity-checks file perms.

## 8. Release plan

**v0.1.0 — public day 1, MIT.** Ship criteria:
1. `doctor.sh` green against author's live setup.
2. Gate unit tests pass, wash-sale boundary cases covered.
3. Live-trade smoke (place + cancel $1 on a live account) passes through the hook.
4. README includes: disclaimer, tested-brokers table, known-limits, 10-minute quickstart, demo transcript.
5. At least one external tester (friend trader) has successfully run setup.sh on a clean machine.

**v0.2 roadmap:**
- Day-P&L circuit breaker tool.
- Mandatory `[[theses/*]]` link on destructive trades.
- Brokerage-specific quirk docs (extended hours, RH read-only, etc).
- UW-MCP wrapper shipped as a separate OSS dep.
- `clitrader` — thin CLI that bundles this kit w/ Vercel AI SDK for non-Claude LLM use. Optional, earned by demand.

## 9. Dependencies

**Shipped in this repo:**
- `trade-guard-mcp` source (TS).
- setup.sh, doctor.sh, pre-tool-use.js.
- CLAUDE.md template + profile templates + vault template.

**User installs via setup.sh:**
- `trade-guard-mcp` (this repo, npm-published).
- `snaptrade-trade-mcp` (author, published).
- `snaptrade-mcp-ts` (upstream, published).
- TradeStation MCP (path documented).
- `exa-mcp` (published).
- UW-MCP wrapper (optional; deferred to v0.2 or out-of-repo).
- radon-mcp-shim (optional).

**trade-guard-mcp deps:**
- `@modelcontextprotocol/sdk`, `zod`, `yaml`, `js-yaml` or native `yaml`.

## 10. Repo layout

```
mcp-trader-kit/
├── README.md
├── SETUP.md
├── LICENSE
├── .gitignore
├── scripts/
│   ├── setup.sh
│   ├── doctor.sh
│   ├── refresh.sh
│   └── pre-tool-use.js
├── mcp-servers/
│   └── trade-guard/
│       ├── src/
│       │   ├── index.ts
│       │   ├── tools/{check-trade,check-wash-sale,scan-tlh,list-profiles,set-profile}.ts
│       │   ├── profiles/loader.ts
│       │   ├── profiles/schema.ts
│       │   └── cache.ts
│       ├── test/
│       ├── package.json
│       └── tsconfig.json
├── templates/
│   ├── CLAUDE.md
│   ├── profiles/
│   │   ├── example-personal.md
│   │   └── example-llc.md
│   ├── vault/
│   │   └── wiki/trading/...
│   └── claude-settings.json
├── docs/
│   ├── brokerages.md
│   ├── unusual-whales.md
│   ├── tradestation.md
│   ├── exa.md
│   ├── tax-entity.md
│   ├── risk-gates.md
│   └── proposal-ux.md
└── examples/
    ├── bildof-sample-session.md
    ├── tlh-walkthrough.md
    └── regime-check.md
```

## 11. Design decisions — final lock

| # | Decision | Choice |
|---|---|---|
| 1 | Runtime | User brings MCP client (Claude Code default). No custom CLI in v0.1. |
| 2 | Persistence | Obsidian-style vault template (YAML + wikilinks + append-only). |
| 3 | Multi-account | Markdown profiles + PreToolUse hook reads active profile from session file. |
| 4 | Risk gates | trade-guard-mcp: caps + forbidden-tools + wash-sale (tax_entity pool). |
| 5 | Approval UX | Staged proposals via CLAUDE.md convention; hook enforces hard rules. |
| 6 | Distribution | Cloneable GH repo + npm-published trade-guard-mcp. |
| 7 | OSS model | Public MIT day 1 w/ disclaimer + fail-closed defaults. |
| 8 | Multi-LLM | Deferred to v0.2 via optional `clitrader` wrapper; v0.1 works w/ any MCP-capable client but targets Claude Code. |

## 12. Open items (deferred, not v0.1 blockers)

- UW-MCP wrapper — P1.5 deliverable, separate repo, this kit references it.
- radon MCP shim shape — radon exposes Python; wrapper TBD.
- TradeStation MCP source — user already has running; doc the wiring.
- "MCP client other than Claude Code" docs — minimal note in v0.1, expand on demand.
- `clitrader` (v0.2 optional) — Vercel AI SDK thin CLI that bundles this kit for GPT/Gemini users.

## 13. Disclaimer (READ ME)

mcp-trader-kit places real orders against real brokerage accounts via SnapTrade and other brokers. The authors disclaim all liability for losses, tax consequences, broker-side errors, model hallucinations, or any other outcome of its use. Not financial advice. You are responsible for every order approved in the REPL. Review every proposal block before approving. Test on paper/sandbox accounts first. Do not disable the PreToolUse hook. Do not remove the risk gates.
