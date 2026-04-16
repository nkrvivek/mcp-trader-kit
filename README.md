# traderkit

Packaged Claude-Code-as-trading-terminal setup. Clone, run `./scripts/setup.sh`, get:

- **Risk-gated trade execution** — caps, forbidden tools/legs, wash-sale pre-trade check.
- **Obsidian-style vault** for theses, trades, sessions, regime.
- **Multi-account profiles** with `tax_entity`-scoped wash-sale pooling.
- **Staged-proposal UX** — model shows a numbered proposal before every destructive tool, you approve in natural language.
- Works with **SnapTrade-supported brokers** (Fidelity, E-Trade, Robinhood-read-only, IBKR, Schwab), **TradeStation**, **EXA** research, optional **Unusual Whales** and **radon** (IBKR direct).

## ⚠️ Disclaimer

This software places real orders against real brokerage accounts. The authors disclaim all liability for losses, tax consequences, broker-side errors, model hallucinations, or any other outcome of its use. **Not financial advice.** You are responsible for every order approved in the REPL. Test on paper/sandbox accounts first. Do not disable the PreToolUse hook. Do not remove the risk gates.

## Quickstart

```bash
git clone https://github.com/nkrvivek/traderkit
cd traderkit
npm install
./scripts/setup.sh
# edit ~/.traderkit/.env with credentials
# edit ~/.traderkit/profiles/*.md with your account_ids
./scripts/doctor.sh
cd vault && claude
```

See [SETUP.md](SETUP.md) for the full walkthrough.

## Architecture

One MCP (`traderkit`) + one PreToolUse hook + markdown profiles + a vault template. Works with Claude Code; other MCP clients supported with a bit of wiring (see `docs/`).

## Tested brokers

See [docs/brokerages.md](docs/brokerages.md). TL;DR: SnapTrade covers Fidelity/E-Trade/IBKR/Schwab read+write, Robinhood read-only. TradeStation via its own MCP. Ally/Morgan Stanley manual.

## License

MIT. See [LICENSE](LICENSE).
