import { z } from "zod";
import { uwOptionChain, uwExpiryList, uwStockState } from "../clients/uw-client.js";
import { TickerSchema } from "../utils/schemas.js";
import { round } from "../utils/math.js";
import { toMessage } from "../utils/errors.js";

export const CalcMaxPainArgs = z.object({
  ticker: TickerSchema,
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  wall_oi_threshold: z.number().int().positive().default(5000),
  top_walls: z.number().int().positive().max(10).default(3),
});

type Args = z.infer<typeof CalcMaxPainArgs>;

interface StrikePain {
  strike: number;
  call_pain: number;
  put_pain: number;
  total_pain: number;
  call_oi: number;
  put_oi: number;
}

interface Wall {
  strike: number;
  oi: number;
  pct_of_total: number;
}

interface Result {
  ticker: string;
  expiry: string;
  spot?: number | undefined;
  max_pain: number;
  max_pain_vs_spot_pct?: number | undefined;
  total_call_oi: number;
  total_put_oi: number;
  put_call_oi_ratio: number;
  call_walls: Wall[];
  put_walls: Wall[];
  pain_curve: StrikePain[];
  interpretation: string[];
}

export async function calcMaxPainHandler(args: unknown): Promise<unknown> {
  const parsed = CalcMaxPainArgs.parse(args);
  return await compute(parsed);
}

async function compute(args: Args): Promise<Result> {
  const T = args.ticker.toUpperCase();

  let expiry = args.expiry;
  if (!expiry) {
    try {
      const list = await uwExpiryList(T);
      if (!list.length) throw new Error(`no expirations available for ${T}`);
      const today = new Date().toISOString().slice(0, 10);
      expiry = list.find((e) => e > today) ?? list[0]!;
    } catch (e) {
      throw new Error(`uw expiry-list failed: ${toMessage(e)}`);
    }
  }

  const chain = await uwOptionChain(T, expiry);
  if (!chain.length) throw new Error(`empty option chain for ${T} ${expiry}`);

  let spot: number | undefined;
  try {
    const s = await uwStockState(T);
    spot = s.price;
  } catch {
    spot = undefined;
  }

  const strikes = Array.from(new Set(chain.map((c) => c.strike))).sort((a, b) => a - b);

  const callByStrike = new Map<number, number>();
  const putByStrike = new Map<number, number>();
  for (const c of chain) {
    const oi = c.open_interest ?? 0;
    if (c.type === "call") callByStrike.set(c.strike, (callByStrike.get(c.strike) ?? 0) + oi);
    else putByStrike.set(c.strike, (putByStrike.get(c.strike) ?? 0) + oi);
  }

  const pain_curve: StrikePain[] = strikes.map((K) => {
    let callPain = 0;
    let putPain = 0;
    for (const [s, oi] of callByStrike) if (s < K) callPain += oi * (K - s);
    for (const [s, oi] of putByStrike) if (s > K) putPain += oi * (s - K);
    return {
      strike: K,
      call_pain: Math.round(callPain),
      put_pain: Math.round(putPain),
      total_pain: Math.round(callPain + putPain),
      call_oi: callByStrike.get(K) ?? 0,
      put_oi: putByStrike.get(K) ?? 0,
    };
  });

  const maxPainRow = pain_curve.reduce((min, row) => (row.total_pain < min.total_pain ? row : min), pain_curve[0]!);

  const total_call_oi = Array.from(callByStrike.values()).reduce((a, b) => a + b, 0);
  const total_put_oi = Array.from(putByStrike.values()).reduce((a, b) => a + b, 0);

  const call_walls: Wall[] = Array.from(callByStrike.entries())
    .filter(([, oi]) => oi >= args.wall_oi_threshold)
    .map(([strike, oi]) => ({
      strike,
      oi,
      pct_of_total: total_call_oi > 0 ? round((oi / total_call_oi) * 100, 10) : 0,
    }))
    .sort((a, b) => b.oi - a.oi)
    .slice(0, args.top_walls);

  const put_walls: Wall[] = Array.from(putByStrike.entries())
    .filter(([, oi]) => oi >= args.wall_oi_threshold)
    .map(([strike, oi]) => ({
      strike,
      oi,
      pct_of_total: total_put_oi > 0 ? round((oi / total_put_oi) * 100, 10) : 0,
    }))
    .sort((a, b) => b.oi - a.oi)
    .slice(0, args.top_walls);

  const pc_ratio = total_call_oi > 0 ? round(total_put_oi / total_call_oi, 100) : 0;

  const interpretation: string[] = [];
  if (spot !== undefined) {
    const vs = ((maxPainRow.strike - spot) / spot) * 100;
    if (Math.abs(vs) < 1) {
      interpretation.push(`spot pinned at max pain — low pin-drift risk`);
    } else if (vs > 0) {
      interpretation.push(`max pain ${vs.toFixed(1)}% ABOVE spot — upward gravity into expiry`);
    } else {
      interpretation.push(`max pain ${Math.abs(vs).toFixed(1)}% BELOW spot — downward gravity into expiry`);
    }
  }
  if (pc_ratio > 1.2) interpretation.push(`P/C OI ratio ${pc_ratio} — bearish hedging bias`);
  else if (pc_ratio < 0.7) interpretation.push(`P/C OI ratio ${pc_ratio} — bullish call skew`);
  else interpretation.push(`P/C OI ratio ${pc_ratio} — balanced`);

  if (put_walls.length) {
    interpretation.push(`put wall ${put_walls[0]!.strike} (${put_walls[0]!.oi.toLocaleString()} OI, ${put_walls[0]!.pct_of_total}%) — support floor; strike candidate for CSP`);
  }
  if (call_walls.length) {
    interpretation.push(`call wall ${call_walls[0]!.strike} (${call_walls[0]!.oi.toLocaleString()} OI, ${call_walls[0]!.pct_of_total}%) — resistance ceiling; strike candidate for CC`);
  }

  return {
    ticker: T,
    expiry,
    spot: spot !== undefined ? round(spot, 100) : undefined,
    max_pain: maxPainRow.strike,
    max_pain_vs_spot_pct: spot !== undefined ? round(((maxPainRow.strike - spot) / spot) * 100, 100) : undefined,
    total_call_oi,
    total_put_oi,
    put_call_oi_ratio: pc_ratio,
    call_walls,
    put_walls,
    pain_curve,
    interpretation,
  };
}
