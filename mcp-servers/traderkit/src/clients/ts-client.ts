import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { toMessage } from "../utils/errors.js";

const TS_API_BASE = process.env.TS_API_BASE ?? "https://api.tradestation.com/v3";
const TS_AUTH_BASE = process.env.TS_AUTH_BASE ?? "https://signin.tradestation.com";
const TOKEN_PATH = process.env.TS_TOKEN_PATH ?? join(homedir(), ".config", "traderkit", "tradestation.json");
const REFRESH_LEEWAY_MS = 60_000;

export interface TsTokenFile {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type?: string;
  scope?: string;
  account_ids?: string[];
}

export class TsAuthError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = "TsAuthError";
  }
}

async function readTokenFile(): Promise<TsTokenFile> {
  let raw: string;
  try {
    raw = await fs.readFile(TOKEN_PATH, "utf8");
  } catch (e) {
    throw new TsAuthError(
      `TS token file missing at ${TOKEN_PATH}`,
      "Run: node dist/bin/ts-auth.js  (or npx traderkit-ts-auth) — one-time OAuth setup",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TsAuthError(`TS token file at ${TOKEN_PATH} is not valid JSON`);
  }
  const t = parsed as Partial<TsTokenFile>;
  if (!t.access_token || !t.refresh_token || typeof t.expires_at !== "number") {
    throw new TsAuthError(`TS token file at ${TOKEN_PATH} is missing required fields`);
  }
  return t as TsTokenFile;
}

async function writeTokenFile(token: TsTokenFile): Promise<void> {
  await fs.mkdir(dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

async function postTokenEndpoint(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${TS_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TsAuthError(`TS token exchange ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as TokenResponse;
}

export async function refreshAccessToken(current: TsTokenFile): Promise<TsTokenFile> {
  const clientId = process.env.TS_CLIENT_ID;
  if (!clientId) throw new TsAuthError("TS_CLIENT_ID not set");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: current.refresh_token,
  });
  const clientSecret = process.env.TS_CLIENT_SECRET;
  if (clientSecret) body.set("client_secret", clientSecret);
  const resp = await postTokenEndpoint(body);
  const nextTokenType = resp.token_type ?? current.token_type;
  const nextScope = resp.scope ?? current.scope;
  const next: TsTokenFile = {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token ?? current.refresh_token,
    expires_at: Date.now() + resp.expires_in * 1000,
    ...(nextTokenType !== undefined ? { token_type: nextTokenType } : {}),
    ...(nextScope !== undefined ? { scope: nextScope } : {}),
    ...(current.account_ids ? { account_ids: current.account_ids } : {}),
  };
  await writeTokenFile(next);
  return next;
}

export async function exchangeAuthCode(code: string, redirectUri: string): Promise<TsTokenFile> {
  const clientId = process.env.TS_CLIENT_ID;
  if (!clientId) throw new TsAuthError("TS_CLIENT_ID not set");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  });
  const clientSecret = process.env.TS_CLIENT_SECRET;
  if (clientSecret) body.set("client_secret", clientSecret);
  const resp = await postTokenEndpoint(body);
  if (!resp.refresh_token) {
    throw new TsAuthError(
      "TS authorization_code response missing refresh_token",
      "Ensure scope includes 'offline_access' in the authorize URL",
    );
  }
  const token: TsTokenFile = {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token,
    expires_at: Date.now() + resp.expires_in * 1000,
    token_type: resp.token_type ?? "Bearer",
    ...(resp.scope !== undefined ? { scope: resp.scope } : {}),
  };
  await writeTokenFile(token);
  return token;
}

let cached: TsTokenFile | null = null;
let inflight: Promise<TsTokenFile> | null = null;

async function ensureFreshToken(): Promise<TsTokenFile> {
  if (inflight) return inflight;
  const now = Date.now();
  if (cached && cached.expires_at - now > REFRESH_LEEWAY_MS) return cached;
  inflight = (async () => {
    const current = cached ?? (await readTokenFile());
    if (current.expires_at - Date.now() > REFRESH_LEEWAY_MS) {
      cached = current;
      return current;
    }
    const next = await refreshAccessToken(current);
    cached = next;
    return next;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

function sanitize(body: string, token: string): string {
  const stripped = token ? body.split(token).join("[redacted]") : body;
  return stripped.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 400);
}

interface RequestOpts {
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "DELETE";
}

export async function tsRequest(path: string, opts: RequestOpts = {}): Promise<unknown> {
  const method = opts.method ?? "GET";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const url = `${TS_API_BASE}${path}${qs.toString() ? `?${qs}` : ""}`;
  let triedRefresh = false;

  while (true) {
    const token = await ensureFreshToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
      "User-Agent": "traderkit/0.5 (+https://github.com/nkrvivek/traderkit)",
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, { method, headers, ...(body !== undefined ? { body } : {}) });
    const text = await res.text();
    if (res.status === 401 && !triedRefresh) {
      triedRefresh = true;
      cached = null;
      try {
        await refreshAccessToken(await readTokenFile());
      } catch (e) {
        throw new TsAuthError(`TS 401 + refresh failed: ${toMessage(e)}`);
      }
      continue;
    }
    if (!res.ok) {
      throw new Error(`TS ${res.status} ${method} ${path}: ${sanitize(text, token.access_token)}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

function joinAccountIds(ids: string[]): string {
  if (!ids.length) throw new Error("at least one account id required");
  return ids.map((s) => s.trim()).filter(Boolean).join(",");
}

export interface TsBalance {
  AccountID: string;
  CashBalance?: string;
  BuyingPower?: string;
  Equity?: string;
  MarketValue?: string;
  TodaysProfitLoss?: string;
  UnclearedDeposit?: string;
  UnsettledFunds?: string;
  raw: Record<string, unknown>;
}

export async function tsBalances(accountIds: string[]): Promise<TsBalance[]> {
  const json = (await tsRequest(`/brokerage/accounts/${joinAccountIds(accountIds)}/balances`)) as {
    Balances?: Record<string, unknown>[];
  };
  return (json?.Balances ?? []).map((r) => {
    const cb = r["CashBalance"] ?? r["cashBalance"];
    const bp = r["BuyingPower"] ?? r["buyingPower"];
    const eq = r["Equity"] ?? r["equity"];
    const mv = r["MarketValue"] ?? r["marketValue"];
    const tpl = r["TodaysProfitLoss"] ?? r["todaysProfitLoss"];
    return {
      AccountID: String(r["AccountID"] ?? r["accountId"] ?? ""),
      ...(cb !== undefined ? { CashBalance: String(cb) } : {}),
      ...(bp !== undefined ? { BuyingPower: String(bp) } : {}),
      ...(eq !== undefined ? { Equity: String(eq) } : {}),
      ...(mv !== undefined ? { MarketValue: String(mv) } : {}),
      ...(tpl !== undefined ? { TodaysProfitLoss: String(tpl) } : {}),
      raw: r,
    } as TsBalance;
  });
}

export interface TsPosition {
  AccountID: string;
  Symbol: string;
  Quantity: string;
  AveragePrice?: string;
  MarketValue?: string;
  UnrealizedProfitLoss?: string;
  AssetType?: string;
  raw: Record<string, unknown>;
}

export async function tsPositions(accountIds: string[]): Promise<TsPosition[]> {
  const json = (await tsRequest(`/brokerage/accounts/${joinAccountIds(accountIds)}/positions`)) as {
    Positions?: Record<string, unknown>[];
  };
  return (json?.Positions ?? []).map((r) => {
    const ap = r["AveragePrice"] ?? r["averagePrice"];
    const mv = r["MarketValue"] ?? r["marketValue"];
    const upl = r["UnrealizedProfitLoss"] ?? r["unrealizedProfitLoss"];
    const at = r["AssetType"] ?? r["assetType"];
    return {
      AccountID: String(r["AccountID"] ?? r["accountId"] ?? ""),
      Symbol: String(r["Symbol"] ?? r["symbol"] ?? ""),
      Quantity: String(r["Quantity"] ?? r["quantity"] ?? "0"),
      ...(ap !== undefined ? { AveragePrice: String(ap) } : {}),
      ...(mv !== undefined ? { MarketValue: String(mv) } : {}),
      ...(upl !== undefined ? { UnrealizedProfitLoss: String(upl) } : {}),
      ...(at !== undefined ? { AssetType: String(at) } : {}),
      raw: r,
    } as TsPosition;
  });
}

export interface TsQuote {
  Symbol: string;
  Last?: string;
  Bid?: string;
  Ask?: string;
  Volume?: string;
  PreviousClose?: string;
  raw: Record<string, unknown>;
}

export async function tsQuotes(symbols: string[]): Promise<TsQuote[]> {
  if (!symbols.length) return [];
  const path = `/marketdata/quotes/${symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",")}`;
  const json = (await tsRequest(path)) as { Quotes?: Record<string, unknown>[] };
  return (json?.Quotes ?? []).map((r) => {
    const last = r["Last"] ?? r["last"];
    const bid = r["Bid"] ?? r["bid"];
    const ask = r["Ask"] ?? r["ask"];
    const vol = r["Volume"] ?? r["volume"];
    const pc = r["PreviousClose"] ?? r["previousClose"];
    return {
      Symbol: String(r["Symbol"] ?? r["symbol"] ?? ""),
      ...(last !== undefined ? { Last: String(last) } : {}),
      ...(bid !== undefined ? { Bid: String(bid) } : {}),
      ...(ask !== undefined ? { Ask: String(ask) } : {}),
      ...(vol !== undefined ? { Volume: String(vol) } : {}),
      ...(pc !== undefined ? { PreviousClose: String(pc) } : {}),
      raw: r,
    } as TsQuote;
  });
}

export interface TsOrder {
  OrderID: string;
  AccountID: string;
  Status: string;
  Symbol?: string;
  Quantity?: string;
  FilledQuantity?: string;
  LimitPrice?: string;
  StopPrice?: string;
  OrderType?: string;
  TradeAction?: string;
  Duration?: string;
  raw: Record<string, unknown>;
}

export async function tsOrders(accountIds: string[]): Promise<TsOrder[]> {
  const json = (await tsRequest(`/brokerage/accounts/${joinAccountIds(accountIds)}/orders`)) as {
    Orders?: Record<string, unknown>[];
  };
  return (json?.Orders ?? []).map((r) => {
    const sym = r["Symbol"] ?? r["symbol"];
    const qty = r["Quantity"] ?? r["quantity"];
    const fq = r["FilledQuantity"] ?? r["filledQuantity"];
    const lp = r["LimitPrice"] ?? r["limitPrice"];
    const sp = r["StopPrice"] ?? r["stopPrice"];
    const ot = r["OrderType"] ?? r["orderType"];
    const ta = r["TradeAction"] ?? r["tradeAction"];
    const dur = r["Duration"] ?? r["duration"];
    return {
      OrderID: String(r["OrderID"] ?? r["orderId"] ?? ""),
      AccountID: String(r["AccountID"] ?? r["accountId"] ?? ""),
      Status: String(r["Status"] ?? r["status"] ?? ""),
      ...(sym !== undefined ? { Symbol: String(sym) } : {}),
      ...(qty !== undefined ? { Quantity: String(qty) } : {}),
      ...(fq !== undefined ? { FilledQuantity: String(fq) } : {}),
      ...(lp !== undefined ? { LimitPrice: String(lp) } : {}),
      ...(sp !== undefined ? { StopPrice: String(sp) } : {}),
      ...(ot !== undefined ? { OrderType: String(ot) } : {}),
      ...(ta !== undefined ? { TradeAction: String(ta) } : {}),
      ...(dur !== undefined ? { Duration: String(dur) } : {}),
      raw: r,
    } as TsOrder;
  });
}

export interface TsPlaceOrderInput {
  AccountID: string;
  Symbol: string;
  Quantity: string;
  OrderType: "Market" | "Limit" | "StopMarket" | "StopLimit";
  TradeAction: "BUY" | "SELL" | "BUYTOCOVER" | "SELLSHORT" | "BUYTOOPEN" | "SELLTOOPEN" | "BUYTOCLOSE" | "SELLTOCLOSE";
  TimeInForce: { Duration: "DAY" | "GTC" | "GTD" | "OPG" | "CLO" | "IOC" | "FOK" };
  LimitPrice?: string;
  StopPrice?: string;
  Route?: string;
}

export interface TsPlaceOrderResult {
  Orders?: Array<{ OrderID?: string; Message?: string; Status?: string }>;
  Errors?: Array<{ Message?: string; Symbol?: string }>;
  raw: unknown;
}

export async function tsPlaceOrder(order: TsPlaceOrderInput): Promise<TsPlaceOrderResult> {
  const json = await tsRequest(`/orderexecution/orders`, { method: "POST", body: order });
  const j = (json ?? {}) as Record<string, unknown>;
  const orders = j["Orders"] as TsPlaceOrderResult["Orders"];
  const errors = j["Errors"] as TsPlaceOrderResult["Errors"];
  return {
    ...(orders !== undefined ? { Orders: orders } : {}),
    ...(errors !== undefined ? { Errors: errors } : {}),
    raw: json,
  };
}

export async function tsConfirmOrder(order: TsPlaceOrderInput): Promise<unknown> {
  return tsRequest(`/orderexecution/orderconfirm`, { method: "POST", body: order });
}

export function _resetCacheForTests(): void {
  cached = null;
  inflight = null;
}

export const _internals = {
  TOKEN_PATH,
  REFRESH_LEEWAY_MS,
  readTokenFile,
  writeTokenFile,
};
