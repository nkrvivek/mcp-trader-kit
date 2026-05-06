#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { exchangeAuthCode, _internals } from "../clients/ts-client.js";

const TS_AUTH_BASE = process.env.TS_AUTH_BASE ?? "https://signin.tradestation.com";
const REDIRECT_PORT = Number(process.env.TS_REDIRECT_PORT ?? 5391);
const REDIRECT_URI = process.env.TS_REDIRECT_URI ?? `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = process.env.TS_SCOPES ?? "openid offline_access profile MarketData ReadAccount Trade";
const AUDIENCE = process.env.TS_AUDIENCE ?? "https://api.tradestation.com";

function open(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}

function buildAuthorizeUrl(state: string): string {
  const clientId = process.env.TS_CLIENT_ID;
  if (!clientId) throw new Error("TS_CLIENT_ID env var is required");
  const u = new URL(`${TS_AUTH_BASE}/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("audience", AUDIENCE);
  u.searchParams.set("state", state);
  return u.toString();
}

async function main(): Promise<void> {
  if (!process.env.TS_CLIENT_ID) {
    console.error("ERROR: TS_CLIENT_ID not set.");
    console.error("Get credentials at https://api.tradestation.com — create an app, set redirect URI.");
    process.exit(1);
  }
  const state = Math.random().toString(36).slice(2);
  const url = buildAuthorizeUrl(state);

  const got: Promise<{ code: string; state?: string }> = new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end("not found");
        return;
      }
      const code = u.searchParams.get("code");
      const stReturned = u.searchParams.get("state") ?? undefined;
      const errCode = u.searchParams.get("error");
      if (errCode) {
        res.writeHead(400, { "content-type": "text/plain" }).end(`oauth error: ${errCode}`);
        server.close();
        reject(new Error(`oauth error: ${errCode}`));
        return;
      }
      if (!code) {
        res.writeHead(400, { "content-type": "text/plain" }).end("missing code");
        server.close();
        reject(new Error("redirect missing code"));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(
        `<html><body style="font-family:monospace;padding:2em">
          <h2>TradeStation auth complete.</h2>
          <p>You can close this tab.</p>
        </body></html>`,
      );
      server.close();
      resolve({ code, ...(stReturned ? { state: stReturned } : {}) });
    });
    server.on("error", reject);
    server.listen(REDIRECT_PORT, () => {
      console.error(`Listening on ${REDIRECT_URI}`);
      console.error(`Opening: ${url}`);
      open(url);
    });
  });

  const { code, state: stReturned } = await got;
  if (stReturned && stReturned !== state) {
    console.error("WARN: state mismatch — proceeding but verify the request was yours");
  }
  const token = await exchangeAuthCode(code, REDIRECT_URI);
  console.error(`OK: token persisted to ${_internals.TOKEN_PATH}`);
  console.error(`expires_at: ${new Date(token.expires_at).toISOString()}`);
  console.error(`scope: ${token.scope ?? "(unknown)"}`);
}

main().catch((e) => {
  console.error("ts-auth failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
