import { z } from "zod";
import { uwOptionChain, uwStockState } from "../clients/uw-client.js";
import { TickerSchema, IsoDateSchema } from "../utils/schemas.js";
import { daysBetween } from "../utils/date.js";
import { round } from "../utils/math.js";

const LegSchema = z.object({
  action: z.enum(["BUY", "SELL"]),
  right: z.enum(["C", "P"]),
  strike: z.number().positive(),
  expiry: IsoDateSchema,
  ratio: z.number().int().positive().default(1),
});

export const ComboFillabilityArgs = z.object({
  ticker: TickerSchema,
  legs: z.array(LegSchema).min(2),
  net_price: z.number(),
  tif: z.enum(["DAY", "GTC"]).default("DAY"),
  now: z.string().optional(),
  close_time: z.string().optional(),
  underlying_adv_30d: z.number().positive().optional(),
});

type Args = z.infer<typeof ComboFillabilityArgs>;
type Leg = z.infer<typeof LegSchema>;

export interface ComboFillabilityResult {
  score: "HIGH" | "MEDIUM" | "LOW";
  numeric_score: number;
  reasons: string[];
  inputs: {
    near_leg: { action: "BUY" | "SELL"; right: "C" | "P"; strike: number; expiry: string; dte: number; oi?: number | undefined; bid?: number | undefined; ask?: number | undefined; mid?: number | undefined };
    far_leg:  { action: "BUY" | "SELL"; right: "C" | "P"; strike: number; expiry: string; dte: number; oi?: number | undefined; bid?: number | undefined; ask?: number | undefined; mid?: number | undefined };
    underlying: { price?: number | undefined; adv_30d?: number | undefined; spot_to_near_strike_pct?: number | undefined };
    minutes_to_close: number;
    tif: "DAY" | "GTC";
  };
  suggestion: "SUBMIT" | "REPRICE_MID" | "LEG_OUT" | "CANCEL";
  leg_out_plan?: {
    btc: { action: "BUY"; right: "C" | "P"; strike: number; expiry: string; est_price: number };
    sto: { action: "SELL"; right: "C" | "P"; strike: number; expiry: string; est_price: number };
    est_net: number;
    slippage_vs_combo: number;
    note: string;
  } | undefined;
  warnings: string[];
}

function defaultCloseTime(nowIso: string): string {
  const d = new Date(nowIso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}T20:00:00Z`;
}

export async function comboFillabilityHandler(raw: unknown): Promise<ComboFillabilityResult> {
  const args: Args = ComboFillabilityArgs.parse(raw);
  const warnings: string[] = [];

  const sorted = [...args.legs].sort((a, b) => a.expiry.localeCompare(b.expiry));
  const near = sorted[0]!;
  const far = sorted[sorted.length - 1]!;
  if (near.expiry === far.expiry) {
    warnings.push("legs share expiry — not a calendar/diagonal; fillability heuristic tuned for cross-expiry combos");
  }

  const uniqueExpiries = Array.from(new Set(args.legs.map((l) => l.expiry)));
  const chains = await Promise.all(
    uniqueExpiries.map((e) =>
      uwOptionChain(args.ticker, e)
        .then((chain) => ({ expiry: e, chain } as const))
        .catch(() => ({ expiry: e, chain: [] as any[] } as const)),
    ),
  );
  const chainMap = new Map(chains.map((c) => [c.expiry, c.chain]));

  function lookup(leg: Leg) {
    const chain = chainMap.get(leg.expiry) ?? [];
    const rightLower = leg.right === "P" ? "put" : "call";
    return chain.find((c) => c.type === rightLower && Math.abs(c.strike - leg.strike) < 0.01);
  }

  const nearQuote = lookup(near);
  const farQuote = lookup(far);
  if (!nearQuote) warnings.push(`near leg ${near.right}${near.strike} ${near.expiry} not found in chain`);
  if (!farQuote) warnings.push(`far leg ${far.right}${far.strike} ${far.expiry} not found in chain`);

  const state = await uwStockState(args.ticker).catch(() => ({ price: undefined }));
  const spot = state.price;
  const adv = args.underlying_adv_30d;
  if (adv === undefined) warnings.push("underlying_adv_30d not provided; ADV rule skipped");

  const nowIso = args.now ?? new Date().toISOString();
  const closeIso = args.close_time ?? defaultCloseTime(nowIso);
  const nowMs = new Date(nowIso).getTime();
  const closeMs = new Date(closeIso).getTime();
  const minutesToClose = Math.max(0, Math.round((closeMs - nowMs) / 60000));

  const nearDte = daysBetween(nowIso.slice(0, 10), near.expiry);
  const farDte = daysBetween(nowIso.slice(0, 10), far.expiry);

  let score = 100;
  const reasons: string[] = [];

  if (nearDte <= 1) { score -= 25; reasons.push(`near-leg DTE ${nearDte} ≤ 1 (expiry-day/next-day)`); }

  const nearOi = nearQuote?.open_interest;
  if (nearOi !== undefined && nearOi < 2000) {
    score -= 20;
    reasons.push(`near-leg OI ${nearOi} < 2,000 (tight MM book)`);
  }

  if (adv !== undefined && adv < 5_000_000) {
    score -= 15;
    reasons.push(`underlying ADV ${adv.toLocaleString()} < 5,000,000 (thin tape)`);
  }

  let spotToNearPct: number | undefined;
  if (spot !== undefined && near.strike > 0) {
    spotToNearPct = Math.abs((spot - near.strike) / near.strike);
    if (spotToNearPct <= 0.10) {
      score -= 10;
      reasons.push(`spot ${spot} within ${round(spotToNearPct * 100, 100)}% of near strike ${near.strike} (gamma pin)`);
    }
  }

  if (minutesToClose < 60) {
    score -= 15;
    reasons.push(`${minutesToClose} min to close (< 60)`);
  }

  function widthPct(q: any): number | undefined {
    if (!q) return undefined;
    const bid = q.bid, ask = q.ask;
    if (bid === undefined || ask === undefined) return undefined;
    const mid = (bid + ask) / 2;
    if (mid <= 0) return undefined;
    return (ask - bid) / mid;
  }
  const nearWidth = widthPct(nearQuote);
  const farWidth = widthPct(farQuote);
  if ((nearWidth !== undefined && nearWidth > 0.20) || (farWidth !== undefined && farWidth > 0.20)) {
    score -= 15;
    reasons.push(`bid/ask width > 20% of mid on ≥1 leg (illiquid)`);
  }

  const nearMid = nearQuote?.mid ?? (nearQuote?.bid !== undefined && nearQuote?.ask !== undefined ? (nearQuote.bid + nearQuote.ask) / 2 : undefined);
  const farMid = farQuote?.mid ?? (farQuote?.bid !== undefined && farQuote?.ask !== undefined ? (farQuote.bid + farQuote.ask) / 2 : undefined);
  if (nearMid !== undefined && farMid !== undefined) {
    const comboMid = farMid - nearMid;
    if (args.net_price < comboMid - 0.05) {
      score -= 10;
      reasons.push(`net price ${args.net_price} below combo mid ${round(comboMid, 100)} by > $0.05 (MM adverse)`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  const band: ComboFillabilityResult["score"] = score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";

  let suggestion: ComboFillabilityResult["suggestion"];
  if (band === "HIGH") suggestion = "SUBMIT";
  else if (band === "MEDIUM") suggestion = "REPRICE_MID";
  else if (args.net_price <= 0 && minutesToClose < 30) suggestion = "CANCEL";
  else suggestion = "LEG_OUT";

  let legOutPlan: ComboFillabilityResult["leg_out_plan"] | undefined;
  if (suggestion === "LEG_OUT") {
    const btcPrice = nearQuote?.ask ?? nearMid ?? 0;
    const stoPrice = farQuote?.bid ?? farMid ?? 0;
    const estNet = round(stoPrice - btcPrice, 100);
    const slippage = round(estNet - args.net_price, 100);
    legOutPlan = {
      btc: { action: "BUY", right: near.right, strike: near.strike, expiry: near.expiry, est_price: round(btcPrice, 100) },
      sto: { action: "SELL", right: far.right, strike: far.strike, expiry: far.expiry, est_price: round(stoPrice, 100) },
      est_net: estNet,
      slippage_vs_combo: slippage,
      note: "BTC near @ ask (likely instant fill), STO far @ bid (likely fill; walk up if needed)",
    };
  }

  return {
    score: band,
    numeric_score: score,
    reasons,
    inputs: {
      near_leg: { action: near.action, right: near.right, strike: near.strike, expiry: near.expiry, dte: nearDte, oi: nearQuote?.open_interest, bid: nearQuote?.bid, ask: nearQuote?.ask, mid: nearMid },
      far_leg:  { action: far.action,  right: far.right,  strike: far.strike,  expiry: far.expiry,  dte: farDte,  oi: farQuote?.open_interest,  bid: farQuote?.bid,  ask: farQuote?.ask,  mid: farMid },
      underlying: { price: spot, adv_30d: adv, spot_to_near_strike_pct: spotToNearPct !== undefined ? round(spotToNearPct, 10_000) : undefined },
      minutes_to_close: minutesToClose,
      tif: args.tif,
    },
    suggestion,
    leg_out_plan: legOutPlan,
    warnings,
  };
}
