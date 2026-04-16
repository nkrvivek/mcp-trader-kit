import { toMessage } from "../utils/errors.js";

const UW_BASE = process.env.UW_BASE ?? "https://api.unusualwhales.com/api";

export interface UWOptionContract {
  option_symbol: string;
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  bid?: number | undefined;
  ask?: number | undefined;
  mid?: number | undefined;
  delta?: number | undefined;
  gamma?: number | undefined;
  theta?: number | undefined;
  vega?: number | undefined;
  iv?: number | undefined;
  open_interest?: number | undefined;
  volume?: number | undefined;
}

export interface UWIvRank {
  ticker: string;
  iv_rank?: number | undefined;
  iv_percentile?: number | undefined;
  iv30?: number | undefined;
}

function sanitizeBody(body: string, token: string): string {
  const stripped = token ? body.split(token).join("[redacted]") : body;
  return stripped.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 200);
}

async function uwGet(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const token = process.env.UW_TOKEN;
  if (!token) throw new Error("UW_TOKEN not set");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const url = `${UW_BASE}${path}${qs.toString() ? `?${qs}` : ""}`;
  const maxAttempts = 3;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "traderkit/0.5 (+https://github.com/nkrvivek/traderkit)",
      },
    });
    const body = await res.text();
    if (!res.ok) {
      if (res.status >= 500 && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw new Error(`UW ${res.status} ${path}: ${sanitizeBody(body, token)}`);
    }
    try {
      return JSON.parse(body);
    } catch (err) {
      lastErr = err as Error;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
    }
  }
  throw new Error(`UW ${path}: schema-text response after ${maxAttempts} attempts (${lastErr?.message})`);
}

function parseOccSymbol(sym: string): { ticker: string; expiry: string; type: "call" | "put"; strike: number } | null {
  const s = sym.trim().replace(/\s+/g, "");
  const m = s.match(/^([A-Z.]{1,6})(\d{6})([CP])(\d{8})$/);
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null;
  const ticker = m[1];
  const yymmdd = m[2];
  const cp = m[3];
  const strikeRaw = m[4];
  const yy = Number(yymmdd.slice(0, 2));
  const year = yy < 70 ? 2000 + yy : 1900 + yy;
  const expiry = `${year}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  return {
    ticker,
    expiry,
    type: cp === "C" ? "call" : "put",
    strike: Number(strikeRaw) / 1000,
  };
}

function toNum(x: unknown): number | undefined {
  if (x === null || x === undefined || x === "") return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function asRecord(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}

function dataArray(x: unknown): Record<string, unknown>[] {
  const rec = asRecord(x);
  return Array.isArray(rec.data) ? (rec.data as Record<string, unknown>[]) : [];
}

export async function uwOptionChain(ticker: string, expiry: string): Promise<UWOptionContract[]> {
  const T = ticker.toUpperCase();
  const today = new Date().toISOString().slice(0, 10);
  const [quotesJson, greeksJson] = await Promise.all([
    uwGet(`/stock/${T}/option-contracts`, { expiry }),
    uwGet(`/stock/${T}/greeks`, { expiry, date: today }).catch((e) => {
      process.stderr.write(`traderkit: uw greeks(${T}, ${expiry}) failed: ${toMessage(e)}\n`);
      return { data: [] };
    }),
  ]);

  const greekRows = dataArray(greeksJson);
  const greeksBySym = new Map<string, { side: "call" | "put"; row: Record<string, unknown> }>();
  for (const row of greekRows) {
    if (row.call_option_symbol) greeksBySym.set(String(row.call_option_symbol), { side: "call", row });
    if (row.put_option_symbol) greeksBySym.set(String(row.put_option_symbol), { side: "put", row });
  }

  const quoteRows = dataArray(quotesJson);
  const out: UWOptionContract[] = [];
  for (const q of quoteRows) {
    const sym = String(q.option_symbol ?? "");
    const parsed = parseOccSymbol(sym);
    if (!parsed) continue;
    const g = greeksBySym.get(sym);
    const bid = toNum(q.nbbo_bid);
    const ask = toNum(q.nbbo_ask);
    const mid = bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined;
    const delta = g ? toNum(g.side === "call" ? g.row.call_delta : g.row.put_delta) : undefined;
    const gamma = g ? toNum(g.side === "call" ? g.row.call_gamma : g.row.put_gamma) : undefined;
    const theta = g ? toNum(g.side === "call" ? g.row.call_theta : g.row.put_theta) : undefined;
    const vega = g ? toNum(g.side === "call" ? g.row.call_vega : g.row.put_vega) : undefined;
    const iv = toNum(q.implied_volatility) ?? (g ? toNum(g.side === "call" ? g.row.call_volatility : g.row.put_volatility) : undefined);
    out.push({
      option_symbol: sym,
      ticker: T,
      type: parsed.type,
      strike: parsed.strike,
      expiry: parsed.expiry,
      bid,
      ask,
      mid,
      delta,
      gamma,
      theta,
      vega,
      iv,
      open_interest: toNum(q.open_interest),
      volume: toNum(q.volume),
    });
  }
  return out;
}

export async function uwExpiryList(ticker: string): Promise<string[]> {
  const json = await uwGet(`/stock/${ticker.toUpperCase()}/expiry-breakdown`, {});
  return dataArray(json).map((r) => String(r.expires ?? r.expiry ?? "")).filter(Boolean);
}

export async function uwIvRank(ticker: string): Promise<UWIvRank> {
  const T = ticker.toUpperCase();
  try {
    const json = await uwGet(`/stock/${T}/iv-rank`, {});
    const rows = dataArray(json);
    const latest = rows.length ? rows[rows.length - 1]! : {};
    return {
      ticker: T,
      iv_rank: toNum(latest.iv_rank),
      iv_percentile: toNum(latest.iv_percentile),
      iv30: toNum(latest.iv30 ?? latest.iv),
    };
  } catch (e) {
    process.stderr.write(`traderkit: uwIvRank(${T}) failed: ${toMessage(e)}\n`);
    return { ticker: T };
  }
}

export async function uwStockState(ticker: string): Promise<{ price?: number | undefined; change_pct?: number | undefined }> {
  const T = ticker.toUpperCase();
  try {
    const json = await uwGet(`/stock/${T}/stock-state`, {});
    const d = asRecord(asRecord(json).data);
    const close = toNum(d.close);
    const prev = toNum(d.prev_close);
    return {
      price: close,
      change_pct: close !== undefined && prev !== undefined && prev > 0 ? (close - prev) / prev : undefined,
    };
  } catch (e) {
    process.stderr.write(`traderkit: uwStockState(${T}) failed: ${toMessage(e)}\n`);
    return {};
  }
}
