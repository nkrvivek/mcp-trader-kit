#!/usr/bin/env node
// scripts/pre-tool-use.js
// Reads Claude Code PreToolUse payload on stdin; calls traderkit gates;
// exits 0 to allow, 2 to block. See docs/risk-gates.md.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KIT_ROOT = process.env.TRADERKIT_ROOT || join(homedir(), ".traderkit");
const SESSION_FILE = join(KIT_ROOT, ".session.json");
const FAIL_CLOSED = process.env.TRADERKIT_FAIL_OPEN !== "true";
const REGIME_FILE = join(KIT_ROOT, ".regime.json");

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

function loadRegimeTier() {
  if (!existsSync(REGIME_FILE)) return "CLEAR";
  try { return JSON.parse(readFileSync(REGIME_FILE, "utf8")).tier ?? "CLEAR"; }
  catch { return "CLEAR"; }
}

function blocked(reason) {
  process.stderr.write(`[traderkit] BLOCKED: ${reason}\n`);
  process.exit(2);
}

async function callTool(child, id, toolName, toolArgs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const handler = (c) => { buf += c; };
    child.stdout.on("data", handler);
    const req = { jsonrpc: "2.0", id, method: "tools/call", params: { name: toolName, arguments: toolArgs } };
    child.stdin.write(JSON.stringify(req) + "\n");
    setTimeout(() => {
      child.stdout.removeListener("data", handler);
      const lines = buf.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === id && msg.result) { resolve(msg); return; }
        } catch {}
      }
      resolve(null);
    }, 3000);
  });
}

function extractTradeArgs(toolName, toolInput, profile) {
  const leg = toolInput.legs?.[0];
  return {
    profile: profile || "default",
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

function parseToolResult(raw) {
  try { return JSON.parse((raw?.result?.content ?? [])[0]?.text ?? "{}"); }
  catch { return {}; }
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

  const child = spawn("npx", ["-y", "traderkit"], { stdio: ["pipe", "pipe", "inherit"] });
  child.on("error", (e) => { if (FAIL_CLOSED) blocked(`spawn failed: ${e.message}`); else process.exit(0); });

  // Initialize MCP
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0", id: 0, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "hook", version: "0" } },
  }) + "\n");

  await new Promise((r) => setTimeout(r, 500));

  const allReasons = [];
  const allWarnings = [];

  // Gate 1: check_trade (caps + wash-sale)
  const tradeArgs = extractTradeArgs(input.tool_name, input.tool_input || {}, active);
  try {
    const r1 = await callTool(child, 1, "check_trade", tradeArgs);
    const p1 = parseToolResult(r1);
    if (p1.pass === false) allReasons.push(...(p1.reasons || []));
    if (p1.warnings?.length) allWarnings.push(...p1.warnings);
  } catch (e) {
    if (FAIL_CLOSED) allReasons.push(`check_trade unavailable: ${e.message}`);
  }

  // Gate 2: regime_gate (sizing + action blocking)
  const regimeTier = loadRegimeTier();
  if (regimeTier !== "CLEAR") {
    try {
      const r2 = await callTool(child, 2, "regime_gate", {
        regime_tier: regimeTier,
        direction: tradeArgs.direction,
        notional_usd: tradeArgs.notional_usd,
      });
      const p2 = parseToolResult(r2);
      if (p2.pass === false) allReasons.push(...(p2.reasons || []));
      if (p2.warnings?.length) allWarnings.push(...p2.warnings);
    } catch (e) {
      allWarnings.push(`regime_gate skipped: ${e.message}`);
    }
  }

  child.stdin.end();

  if (allReasons.length > 0) blocked(allReasons.join("; "));
  if (allWarnings.length > 0) process.stderr.write(`[traderkit] warnings: ${allWarnings.join("; ")}\n`);
  process.exit(0);
})().catch((e) => { if (FAIL_CLOSED) blocked(e.message); else process.exit(0); });
