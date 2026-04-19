#!/usr/bin/env bash
# traderkit bootstrap — zero-to-running on a clean machine.
#
# Installs (only what's missing): Xcode CLT, Homebrew (macOS), Node 20 via nvm,
# Claude Code CLI, then runs ./scripts/setup.sh.
#
# Usage:
#   cd traderkit && bash scripts/bootstrap.sh
# Or one-liner (no clone yet):
#   curl -fsSL https://raw.githubusercontent.com/nkrvivek/traderkit/main/scripts/bootstrap.sh | bash
#
# Safe to re-run. Every step detects existing install and skips.

set -euo pipefail

REPO_URL="https://github.com/nkrvivek/traderkit"
NODE_MAJOR="20"

say()  { printf '\n\033[1;36m› %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

OS="$(uname -s)"

# ── 0. Platform check ────────────────────────────────────────────────────────
case "$OS" in
  Darwin) PLATFORM=macos ;;
  Linux)  PLATFORM=linux ;;
  *) die "Unsupported OS: $OS (macOS or Linux only)" ;;
esac
say "Bootstrap · platform=$PLATFORM"

# ── 1. Xcode CLT + Homebrew (macOS only) ─────────────────────────────────────
if [[ "$PLATFORM" == "macos" ]]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    say "Installing Xcode Command Line Tools (GUI prompt will appear)"
    xcode-select --install || true
    warn "Re-run this script after Xcode CLT finishes installing."
    die "Pausing — complete the Xcode prompt, then re-run bootstrap.sh"
  else
    ok "Xcode CLT present"
  fi

  if ! command -v brew >/dev/null 2>&1; then
    say "Installing Homebrew"
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to current shell PATH
    if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [[ -x /usr/local/bin/brew ]];   then eval "$(/usr/local/bin/brew shellenv)"; fi
  else
    ok "Homebrew present ($(brew --version | head -1))"
  fi
fi

# ── 2. curl + git (required) ─────────────────────────────────────────────────
for bin in curl git; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    if [[ "$PLATFORM" == "macos" ]]; then brew install "$bin"
    else die "$bin missing — apt/yum install $bin and re-run"
    fi
  fi
done
ok "curl + git present"

# ── 3. Node 20 via nvm (user-scoped, no sudo) ────────────────────────────────
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  say "Installing nvm (Node Version Manager)"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

NODE_CUR="$(node --version 2>/dev/null || echo none)"
if [[ "$NODE_CUR" == none || "${NODE_CUR#v}" != ${NODE_MAJOR}.* && "${NODE_CUR#v}" != 2[0-9].* && "${NODE_CUR#v}" != [3-9][0-9].* ]]; then
  say "Installing Node $NODE_MAJOR via nvm"
  nvm install "$NODE_MAJOR"
  nvm alias default "$NODE_MAJOR"
fi
nvm use default >/dev/null
ok "Node $(node --version) · npm $(npm --version)"

# ── 4. Claude Code CLI ───────────────────────────────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  say "Installing Claude Code CLI"
  npm install -g @anthropic-ai/claude-code
else
  ok "Claude Code CLI present ($(claude --version 2>/dev/null | head -1 || echo 'installed'))"
fi

# ── 5. Clone repo if not already inside one ──────────────────────────────────
REPO_ROOT=""
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  if [[ -f "$REPO_ROOT/scripts/setup.sh" && -f "$REPO_ROOT/package.json" ]]; then
    ok "Already in traderkit repo: $REPO_ROOT"
  else
    REPO_ROOT=""
  fi
fi
if [[ -z "$REPO_ROOT" ]]; then
  TARGET="${TRADERKIT_DIR:-$HOME/traderkit}"
  if [[ -d "$TARGET/.git" ]]; then
    say "Updating existing clone at $TARGET"
    git -C "$TARGET" pull --ff-only
  else
    say "Cloning traderkit to $TARGET"
    git clone "$REPO_URL" "$TARGET"
  fi
  REPO_ROOT="$TARGET"
fi
cd "$REPO_ROOT"

# ── 6. npm install + build ───────────────────────────────────────────────────
say "Installing dependencies (this compiles the MCP server once; ~30-60s)"
npm install --no-fund --no-audit
ok "npm install complete"

# ── 7. Run setup.sh ──────────────────────────────────────────────────────────
say "Running setup wizard"
bash ./scripts/setup.sh

# ── 8. Next steps ────────────────────────────────────────────────────────────
cat <<EOF

$(printf '\033[1;32m✓ Bootstrap done.\033[0m')

Next:
  1. Fill creds:    \$EDITOR ~/.traderkit/.env
  2. Fill profile:  \$EDITOR ~/.traderkit/profiles/example-personal.md
                    mv ~/.traderkit/profiles/example-personal.md ~/.traderkit/profiles/main.md
  3. Health check:  bash $REPO_ROOT/scripts/doctor.sh
  4. First run:     cd \$TRADERKIT_VAULT && claude → then type /trade main --mode dry-run

Full walkthrough: $REPO_ROOT/ONBOARDING.md
EOF
