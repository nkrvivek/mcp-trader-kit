#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT_ROOT="${TRADERKIT_ROOT:-$HOME/.traderkit}"
VAULT_DEFAULT="$PWD/vault"

say() { printf '\n\033[1;36m› %s\033[0m\n' "$*"; }
ask() { local prompt="$1" default="${2:-}" reply; read -r -p "$prompt [${default}]: " reply; printf '%s' "${reply:-$default}"; }

say "traderkit setup"
echo "Repo: $REPO_ROOT"
echo "Kit state dir: $KIT_ROOT"

VAULT_PATH="$(ask "Vault path" "$VAULT_DEFAULT")"

say "Creating directories"
mkdir -p "$KIT_ROOT/profiles" "$KIT_ROOT/scripts"
mkdir -p "$VAULT_PATH/.claude" "$VAULT_PATH/wiki/trading"

say "Copying templates → vault"
cp -R "$REPO_ROOT/templates/vault/." "$VAULT_PATH/"
cp "$REPO_ROOT/templates/CLAUDE.md" "$VAULT_PATH/CLAUDE.md"

say "Copying claude-settings.json → vault/.claude/settings.json"
SETTINGS="$VAULT_PATH/.claude/settings.json"
if [[ -f "$SETTINGS" ]]; then
  echo "  $SETTINGS exists — leaving alone (merge manually if needed)"
else
  sed "s|\${HOME}|$HOME|g" "$REPO_ROOT/templates/claude-settings.json" > "$SETTINGS"
fi

say "Copying hook script → $KIT_ROOT/scripts/"
cp "$REPO_ROOT/scripts/pre-tool-use.js" "$KIT_ROOT/scripts/pre-tool-use.js"
chmod +x "$KIT_ROOT/scripts/pre-tool-use.js"

say "Copying profile templates"
for tpl in example-personal example-llc; do
  if [[ ! -f "$KIT_ROOT/profiles/$tpl.md" ]]; then
    cp "$REPO_ROOT/templates/profiles/$tpl.md" "$KIT_ROOT/profiles/$tpl.md"
  fi
done

say "Writing .env template (if missing)"
if [[ ! -f "$KIT_ROOT/.env" ]]; then
  cat > "$KIT_ROOT/.env" <<'EOF'
# traderkit secrets — edit these
ANTHROPIC_API_KEY=
SNAPTRADE_CLIENT_ID=
SNAPTRADE_CONSUMER_KEY=
SNAPTRADE_USER_ID=
SNAPTRADE_USER_SECRET=
EXA_API_KEY=
UW_TOKEN=
EOF
  chmod 600 "$KIT_ROOT/.env"
fi

say "Installing MCP packages (this may take a minute)"
npm install -g trade-guard-mcp snaptrade-trade-mcp snaptrade-mcp-ts 2>/dev/null || \
  echo "  (global install skipped — using 'npx -y' on demand is fine)"

say "Next steps"
cat <<EOF
1. Edit $KIT_ROOT/.env with your credentials.
2. Edit $KIT_ROOT/profiles/*.md — replace placeholder account_ids with UUIDs from snaptrade_list_accounts.
3. Run: bash $REPO_ROOT/scripts/doctor.sh
4. cd $VAULT_PATH && claude
EOF
