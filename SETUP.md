# SETUP

## Prerequisites

- macOS or Linux.
- Node 20+.
- Claude Code CLI (`npm i -g @anthropic-ai/claude-code` or equivalent).
- A SnapTrade account with at least one brokerage connected.
- Credentials for: SnapTrade, optionally EXA, TradeStation, Unusual Whales.

## Step 1: Clone + install

```bash
git clone https://github.com/nkrvivek/traderkit
cd traderkit
npm install
npm run build
```

## Step 2: Run setup.sh

```bash
./scripts/setup.sh
```

The script:
1. Prompts for a vault path (default `./vault`).
2. Copies vault + CLAUDE.md templates.
3. Copies profile templates → `~/.traderkit/profiles/`.
4. Copies the hook script → `~/.traderkit/scripts/`.
5. Writes `~/.traderkit/.env` template (600 perms).
6. Writes `<vault>/.claude/settings.json` (MCP registrations + PreToolUse hook matcher).

## Step 3: Credentials

Edit `~/.traderkit/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
SNAPTRADE_CLIENT_ID=...
SNAPTRADE_CONSUMER_KEY=...
SNAPTRADE_USER_ID=...
SNAPTRADE_USER_SECRET=...
EXA_API_KEY=...
UW_TOKEN=...        # optional
```

## Step 4: Profiles

Edit `~/.traderkit/profiles/example-personal.md` (rename to e.g. `personal.md`). Replace `account_id` with the UUID from a `list_accounts` call. Set realistic caps.

Repeat for each account. Pool wash-sale scope via `tax_entity`: all personal accounts get `personal`; each LLC gets its own `llc-*`.

## Step 5: Verify

```bash
./scripts/doctor.sh
```

Should be all green except for optional components you haven't installed.

## Step 6: Launch

```bash
cd <vault>
claude
```

On first turn, Claude will read CLAUDE.md + the vault, ask which profile to use, and load context. Ask "list profiles" to confirm traderkit is wired.

## Step 7: First trade (paper or sandbox only)

Try: "list positions in `<profile>`", then a small proposal. Verify the hook fires on any destructive tool by watching stderr during the call.

## Troubleshooting

- **Hook never fires:** check `.claude/settings.json` matcher pattern — tool names must start with `mcp__<server-name>__<tool-name>`.
- **Wash-sale check always returns unavailable:** confirm `SNAPTRADE_READ_COMMAND=npx SNAPTRADE_READ_ARGS="-y snaptrade-trade-mcp"` is in the env when traderkit launches (Claude Code inherits the project env).
- **Profile not found:** `traderkit.list_profiles` should show the file name (without `.md`) — if empty, verify YAML frontmatter parses and `TRADERKIT_ROOT` points where you think.
