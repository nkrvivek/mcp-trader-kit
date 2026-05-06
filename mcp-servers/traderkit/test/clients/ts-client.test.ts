import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;
let tokenPath: string;

async function freshImport() {
  vi.resetModules();
  const mod = await import("../../src/clients/ts-client.js");
  mod._resetCacheForTests();
  return mod;
}

async function writeToken(t: { access_token: string; refresh_token: string; expires_at: number }): Promise<void> {
  await fs.writeFile(tokenPath, JSON.stringify(t), { mode: 0o600 });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tk-ts-"));
  tokenPath = join(tmpDir, "tradestation.json");
  process.env.TS_TOKEN_PATH = tokenPath;
  process.env.TS_CLIENT_ID = "test-client-id";
  process.env.TS_API_BASE = "https://api.tradestation.example/v3";
  process.env.TS_AUTH_BASE = "https://signin.tradestation.example";
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.TS_CLIENT_SECRET;
});

describe("ts-client", () => {
  it("uses cached fresh token without network refresh", async () => {
    await writeToken({
      access_token: "cur-AT",
      refresh_token: "RT-1",
      expires_at: Date.now() + 60 * 60 * 1000,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth/token")) throw new Error("should not refresh");
      return new Response(JSON.stringify({ Balances: [{ AccountID: "A1", CashBalance: "100" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tsBalances } = await freshImport();
    const out = await tsBalances(["A1"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.AccountID).toBe("A1");
    expect(out[0]?.CashBalance).toBe("100");
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/oauth/token"));
    expect(tokenCalls).toHaveLength(0);
  });

  it("refreshes when token is within leeway and persists new pair", async () => {
    await writeToken({
      access_token: "old-AT",
      refresh_token: "RT-1",
      expires_at: Date.now() + 30_000,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "new-AT", refresh_token: "RT-2", expires_in: 1200 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ Balances: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tsBalances } = await freshImport();
    await tsBalances(["A1"]);
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/oauth/token"));
    expect(refreshCalls).toHaveLength(1);
    const persisted = JSON.parse(await fs.readFile(tokenPath, "utf8"));
    expect(persisted.access_token).toBe("new-AT");
    expect(persisted.refresh_token).toBe("RT-2");
    expect(persisted.expires_at).toBeGreaterThan(Date.now() + 1_000_000);
  });

  it("retries once after a 401 by forcing a refresh", async () => {
    await writeToken({
      access_token: "stale-AT",
      refresh_token: "RT-1",
      expires_at: Date.now() + 60 * 60 * 1000,
    });
    let apiCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "fresh-AT", refresh_token: "RT-2", expires_in: 1200 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      apiCalls += 1;
      if (apiCalls === 1) return new Response("unauthorized", { status: 401 });
      return new Response(JSON.stringify({ Positions: [{ Symbol: "AAPL", Quantity: "10" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tsPositions } = await freshImport();
    const out = await tsPositions(["A1"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.Symbol).toBe("AAPL");
    expect(apiCalls).toBe(2);
  });

  it("throws TsAuthError if token file missing", async () => {
    const { tsBalances, TsAuthError } = await freshImport();
    await expect(tsBalances(["A1"])).rejects.toBeInstanceOf(TsAuthError);
  });

  it("exchangeAuthCode persists refresh_token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "AT", refresh_token: "RT-NEW", expires_in: 1200, scope: "MarketData" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { exchangeAuthCode } = await freshImport();
    const tok = await exchangeAuthCode("abc", "http://localhost:5391/callback");
    expect(tok.refresh_token).toBe("RT-NEW");
    expect(tok.access_token).toBe("AT");
    const persisted = JSON.parse(await fs.readFile(tokenPath, "utf8"));
    expect(persisted.refresh_token).toBe("RT-NEW");
  });
});
