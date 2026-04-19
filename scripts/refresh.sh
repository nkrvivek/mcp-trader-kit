#!/usr/bin/env bash
# scripts/refresh.sh — portfolio refresh prompt. Prints a prompt the user can paste
# into Claude Code to trigger the standard refresh chain. Does NOT call MCPs directly;
# refresh is a Claude-orchestrated flow by design (vault updates + dashboard edits).

cat <<'EOF'
Refresh the portfolio via the standard chain:

1. Call check_status, list_accounts, get_holdings.
2. For each brokerage, update wiki/trading/<broker>-portfolio.md.
3. Aggregate into wiki/trading/portfolio-master.md.
4. Update totals + "last refresh" timestamp in wiki/trading/dashboard.md.
5. Flag any position >4h stale with 🟡 in dashboard.md.

Paste the above into Claude Code, or run from any session: "refresh the portfolio now."
EOF
