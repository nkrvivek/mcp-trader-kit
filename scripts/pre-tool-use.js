#!/usr/bin/env node
// scripts/pre-tool-use.js
// Reads Claude Code PreToolUse payload on stdin; calls trade-guard check_trade;
// exits 0 to allow, 2 to block. See docs/risk-gates.md.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KIT_ROOT = process.env.TRADERKIT_ROOT || join(homedir(), ".traderkit");
const SESSION_FILE = join(KIT_ROOT, ".session.json");
const FAIL_CLOSED = process.env.TRADERKIT_FAIL_OPEN !== "true";

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function loadActiveProfile() {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, "utf8")).active_profile ?? null; }
  catch { return null; }
}

function blocked(reason) {
  process.stderr.write(`[trade-guard] BLOCKED: ${reason}\n`);
  process.exit(2);
}

async function callCheckTrade(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["-y", "traderkit-guard"], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.on("close", () => {
      try { resolve(JSON.parse(out.split("\n").find((l) => l.includes("\"result\"")) || "{}")); }
      catch (e) { reject(e); }
    });
    child.on("error", reject);
    const req = {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "check_trade", arguments: payload },
    };
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "hook", version: "0" } } }) + "\n");
    child.stdin.write(JSON.stringify(req) + "\n");
    child.stdin.end();
  });
}

function extractTradeArgs(toolName, toolInput, profile) {
  const baseProfile = profile || "default";
  const leg = toolInput.legs?.[0];
  return {
    profile: baseProfile,
    tool: toolName.replace(/^mcp__[^_]+__/, ""),
    ticker: toolInput.ticker || toolInput.symbol || leg?.symbol || "UNKNOWN",
    direction: toolInput.action || leg?.action || "BUY",
    qty: Number(toolInput.units || toolInput.quantity || leg?.quantity || 1),
    notional_usd: Number(toolInput.price || 0) * Number(toolInput.units || toolInput.quantity || 0),
    portfolio_total_usd: 0,
    existing_ticker_exposure_usd: 0,
    require_wash_sale_check: false,
  };
}

(async () => {
  let input;
  try { input = JSON.parse(await readStdin()); }
  catch { if (FAIL_CLOSED) blocked("invalid hook payload"); else process.exit(0); }

  const active = loadActiveProfile();
  if (!active) {
    if (FAIL_CLOSED) blocked("no active profile — run set_profile first");
    else process.exit(0);
  }

  const args = extractTradeArgs(input.tool_name, input.tool_input || {}, active);
  let result;
  try { result = await callCheckTrade(args); }
  catch (e) {
    if (FAIL_CLOSED) blocked(`gate unavailable: ${e.message}`);
    else process.exit(0);
  }

  const payload = JSON.parse((result?.result?.content ?? [])[0]?.text ?? "{}");
  if (payload.pass === false) blocked((payload.reasons || []).join("; "));
  if (payload.warnings?.length) process.stderr.write(`[trade-guard] warnings: ${payload.warnings.join("; ")}\n`);
  process.exit(0);
})().catch((e) => { if (FAIL_CLOSED) blocked(e.message); else process.exit(0); });
