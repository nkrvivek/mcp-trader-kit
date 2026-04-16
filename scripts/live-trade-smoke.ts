// scripts/live-trade-smoke.ts
// Places $1 order + immediate cancel against a live account.
// Gated by TRADERKIT_ALLOW_LIVE=true. DO NOT remove the guard.

if (process.env.TRADERKIT_ALLOW_LIVE !== "true") {
  console.error("REFUSING TO RUN: set TRADERKIT_ALLOW_LIVE=true to proceed (live order will be placed and canceled).");
  process.exit(1);
}

const ACCOUNT_ID = process.env.SMOKE_ACCOUNT_ID;
const PROFILE = process.env.SMOKE_PROFILE;
if (!ACCOUNT_ID || !PROFILE) {
  console.error("Set SMOKE_ACCOUNT_ID and SMOKE_PROFILE env vars.");
  process.exit(1);
}

console.log(`Smoke test: profile=${PROFILE} account=${ACCOUNT_ID}`);
console.log("1. Invoking trade-guard.check_trade on a $1 SPY BUY (should PASS if caps allow).");
console.log("2. Instructing user to call mcp__snaptrade-trade__equity_force_place from Claude Code.");
console.log("3. User should observe hook emits 'trade-guard: pass' on stderr.");
console.log("4. Immediately cancel via mcp__snaptrade-trade__cancel_order.");
console.log();
console.log("This script does not itself call SnapTrade — it's a guided manual E2E.");
console.log("Run Claude Code in the vault, paste the prompt above, and capture the hook output.");
