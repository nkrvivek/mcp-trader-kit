#!/usr/bin/env bash
set -u
KIT_ROOT="${TRADERKIT_ROOT:-$HOME/.traderkit}"
FAIL=0

row() { printf '%-22s %-6s %s\n' "$1" "$2" "$3"; }
pass() { row "$1" "OK" "$2"; }
skip() { row "$1" "SKIP" "$2"; }
fail() { row "$1" "FAIL" "$2"; FAIL=1; }

printf '%-22s %-6s %s\n' "component" "status" "detail"
printf '%-22s %-6s %s\n' "---------" "------" "------"

# kit root
if [[ -d "$KIT_ROOT" ]]; then pass "kit-root" "$KIT_ROOT"; else fail "kit-root" "missing $KIT_ROOT"; fi

# env
if [[ -f "$KIT_ROOT/.env" ]]; then
  perms=$(stat -f '%OLp' "$KIT_ROOT/.env" 2>/dev/null || stat -c '%a' "$KIT_ROOT/.env")
  if [[ "$perms" == "600" ]]; then pass "env-file" "perms 600"; else fail "env-file" "perms $perms (want 600)"; fi
else
  fail "env-file" "missing $KIT_ROOT/.env"
fi

# profiles
count=$(ls "$KIT_ROOT/profiles"/*.md 2>/dev/null | wc -l | tr -d ' ')
if [[ "$count" -ge 1 ]]; then pass "profiles" "$count profile(s)"; else fail "profiles" "no profiles in $KIT_ROOT/profiles"; fi

# hook script
if [[ -x "$KIT_ROOT/scripts/pre-tool-use.js" ]]; then pass "hook-script" "executable"; else fail "hook-script" "missing or not executable"; fi

# traderkit-guard binary
if command -v traderkit-guard >/dev/null 2>&1; then pass "traderkit-guard" "$(which traderkit-guard)"; else skip "traderkit-guard" "not globally installed (npx -y will resolve)"; fi

# snaptrade-trade-mcp
if command -v snaptrade-trade-mcp >/dev/null 2>&1; then pass "snaptrade-trade-mcp" "installed"; else skip "snaptrade-trade-mcp" "not globally installed"; fi

# snaptrade-mcp-ts
if command -v snaptrade-mcp-ts >/dev/null 2>&1; then pass "snaptrade-mcp-ts" "installed"; else skip "snaptrade-mcp-ts" "not globally installed"; fi

# creds
if [[ -f "$KIT_ROOT/.env" ]] && grep -q '^SNAPTRADE_CONSUMER_KEY=..*$' "$KIT_ROOT/.env"; then
  pass "snaptrade-creds" "set"
else
  fail "snaptrade-creds" "SNAPTRADE_CONSUMER_KEY not set in $KIT_ROOT/.env"
fi

echo
if [[ "$FAIL" -eq 0 ]]; then echo "doctor: all green"; exit 0; else echo "doctor: $FAIL issue(s) found"; exit 1; fi
