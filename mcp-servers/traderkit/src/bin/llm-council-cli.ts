#!/usr/bin/env node
// llm-council-cli — black-box CLI wrapper for the llm_council MCP tool.
//
// Reads JSON args from stdin, invokes llmCouncilHandler, writes JSON result to stdout.
// Used by the council-validation harness (Python) to replay historical proposals
// without a long-running MCP session.
//
// Usage:
//   echo '{"candidate":{...},"regime_tier":"caution",...}' | node llm-council-cli.js
//
// On success: writes {"ok": true, "result": <handler result>} to stdout, exits 0.
// On failure: writes {"ok": false, "error": "<message>"} to stdout, exits 1.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load traderkit/.env (Node 20.12+). Silently skip if missing.
try {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/bin/llm-council-cli.js → ../../../../.env points to traderkit repo root .env
  process.loadEnvFile(resolve(here, "../../../../.env"));
} catch {
  // .env optional
}

import { llmCouncilHandler } from "../tools/llm-council.js";

async function readStdin(): Promise<string> {
  return await new Promise((resolveFn, rejectFn) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolveFn(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", rejectFn);
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write(JSON.stringify({ ok: false, error: "empty stdin" }) + "\n");
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: `invalid JSON on stdin: ${(e as Error).message}` }) +
        "\n",
    );
    process.exit(1);
  }
  try {
    const result = await llmCouncilHandler(parsed);
    process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
    process.exit(0);
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: (e as Error).message ?? String(e) }) + "\n",
    );
    process.exit(1);
  }
}

main().catch((e) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: (e as Error).message ?? String(e) }) + "\n",
  );
  process.exit(1);
});
