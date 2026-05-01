import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";
import {
  uwStockOiChange,
  uwMarketOiChange,
  type UWOiChange,
} from "../clients/uw-client.js";

export const FetchOiChangesArgs = z.object({
  ticker: TickerSchema.optional(),
  market_wide: z.boolean().default(false),
  min_oi_change: z.number().int().nonnegative().default(0),
  min_premium: z.number().nonnegative().default(0),
  limit: z.number().int().positive().max(500).default(50),
});

export type SignalStrength = "MASSIVE" | "LARGE" | "SIGNIFICANT" | "MODERATE";
export type SignalDirection =
  | "BULLISH"
  | "BEARISH"
  | "CLOSING BULLISH"
  | "CLOSING BEARISH";

export interface OiChangeCategorized extends UWOiChange {
  strength: SignalStrength;
  direction: SignalDirection;
  is_call: boolean;
  is_leap: boolean;
}

export interface FetchOiChangesResult {
  ticker: string | null;
  market_wide: boolean;
  total_count: number;
  total_oi_change: number;
  total_premium: number;
  massive_count: number;
  data: OiChangeCategorized[];
}

interface FetchOiChangesDeps {
  fetchTicker?: (ticker: string) => Promise<UWOiChange[]>;
  fetchMarket?: () => Promise<UWOiChange[]>;
}

function isCallSymbol(sym: string): boolean {
  // OCC format: ROOTYYMMDDC########  — char at index -9 from end is C/P
  if (sym.length < 9) return true;
  return sym.slice(-9, -8) === "C";
}

function isLeapSymbol(sym: string): boolean {
  // YY portion is at index 4..6 in standard format (root padded). Heuristic checks 27/28.
  const yy = sym.slice(4, 10);
  return yy.includes("27") || yy.includes("28");
}

function categorize(item: UWOiChange): OiChangeCategorized {
  const oiDiff = item.oi_diff_plain;
  const premium = item.prev_total_premium;
  const sym = item.option_symbol;
  const is_call = isCallSymbol(sym);
  const is_leap = isLeapSymbol(sym);

  let strength: SignalStrength;
  if (premium >= 10_000_000) strength = "MASSIVE";
  else if (premium >= 5_000_000) strength = "LARGE";
  else if (premium >= 1_000_000) strength = "SIGNIFICANT";
  else strength = "MODERATE";

  const baseDir = is_call ? "BULLISH" : "BEARISH";
  const direction: SignalDirection = oiDiff < 0
    ? (baseDir === "BULLISH" ? "CLOSING BULLISH" : "CLOSING BEARISH")
    : baseDir;

  return { ...item, strength, direction, is_call, is_leap };
}

export async function fetchOiChangesHandler(
  raw: unknown,
  deps: FetchOiChangesDeps = {},
): Promise<FetchOiChangesResult> {
  const args = FetchOiChangesArgs.parse(raw);
  if (!args.market_wide && !args.ticker) {
    throw new Error("either ticker or market_wide=true required");
  }
  const fetchTicker = deps.fetchTicker ?? uwStockOiChange;
  const fetchMarket = deps.fetchMarket ?? uwMarketOiChange;

  const ticker = args.ticker ?? null;
  const rows = args.market_wide
    ? await fetchMarket()
    : await fetchTicker(ticker as string);

  const filtered = rows.filter(
    (r) => Math.abs(r.oi_diff_plain) >= args.min_oi_change && r.prev_total_premium >= args.min_premium,
  );
  const limited = filtered.slice(0, args.limit);
  const data = limited.map(categorize);

  const total_oi_change = data.reduce((s, r) => s + r.oi_diff_plain, 0);
  const total_premium = Math.round(data.reduce((s, r) => s + r.prev_total_premium, 0) * 100) / 100;
  const massive_count = data.filter((r) => r.strength === "MASSIVE").length;

  return {
    ticker,
    market_wide: args.market_wide,
    total_count: data.length,
    total_oi_change,
    total_premium,
    massive_count,
    data,
  };
}
