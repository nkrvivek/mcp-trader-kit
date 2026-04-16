import { z } from "zod";
import { uwOptionChain, uwExpiryList, uwStockState } from "../clients/uw-client.js";

export const CalcRollArgs = z.object({
  ticker: z.string().min(1).max(10),
  option_type: z.enum(["put", "call"]),
  current_strike: z.number().positive(),
  current_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  qty: z.number().int().positive().default(1),
  entry_credit_per: z.number().nonnegative().optional(),
  direction: z.enum(["out", "out_and_down", "out_and_up"]).default("out"),
  min_net_credit: z.number().default(0),
  min_dte_extension: z.number().int().positive().default(7),
  max_dte_extension: z.number().int().positive().default(90),
  max_strike_adjust: z.number().nonnegative().default(10),
  min_oi: z.number().int().nonnegative().default(50),
  max_results: z.number().int().positive().max(50).default(15),
});

type Args = z.infer<typeof CalcRollArgs>;

interface RollCandidate {
  ticker: string;
  btc_cost_per: number;
  new_strike: number;
  new_expiry: string;
  dte_extension: number;
  sto_credit_per: number;
  net_credit_per: number;
  net_credit_total: number;
  new_delta: number;
  new_pop: number;
  new_oi: number;
  new_iv?: number | undefined;
  underlying_price?: number | undefined;
  score: number;
  improvement: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T16:00:00-04:00`).getTime();
  const b = new Date(`${toIso}T16:00:00-04:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function daysUntil(iso: string): number {
  const t = new Date(`${iso}T16:00:00-04:00`).getTime();
  return Math.round((t - Date.now()) / 86_400_000);
}

export async function calcRollHandler(raw: unknown): Promise<{
  btc_cost_per?: number | undefined;
  underlying_price?: number | undefined;
  rolls: RollCandidate[];
  warnings: string[];
}> {
  const args = CalcRollArgs.parse(raw);
  const warnings: string[] = [];
  const ticker = args.ticker.toUpperCase();

  const [state, currentChain, expiries] = await Promise.all([
    uwStockState(ticker),
    uwOptionChain(ticker, args.current_expiry),
    uwExpiryList(ticker),
  ]);

  const currentLeg = currentChain.find(
    (c) => c.type === args.option_type && Math.abs(c.strike - args.current_strike) < 0.01
  );
  if (!currentLeg) {
    return {
      underlying_price: state.price,
      rolls: [],
      warnings: [`current leg ${ticker} ${args.current_expiry} ${args.option_type.toUpperCase()} ${args.current_strike} not found`],
    };
  }
  const btcCostPer = currentLeg.ask ?? currentLeg.mid ?? 0;
  if (!btcCostPer) warnings.push("BTC cost unavailable; using mid");
  if (args.option_type === "call" && state.price && state.price > args.current_strike) {
    warnings.push(`short call ITM: spot ${state.price} > strike ${args.current_strike}`);
  }
  if (args.option_type === "put" && state.price && state.price < args.current_strike) {
    warnings.push(`short put ITM: spot ${state.price} < strike ${args.current_strike}`);
  }

  const futureExpiries = expiries.filter((e) => {
    const ext = daysBetween(args.current_expiry, e);
    return ext >= args.min_dte_extension && ext <= args.max_dte_extension;
  });

  const rolls: RollCandidate[] = [];
  for (const expiry of futureExpiries) {
    const chain = await uwOptionChain(ticker, expiry);
    const legs = chain.filter((c) => c.type === args.option_type);
    for (const leg of legs) {
      if (leg.delta === undefined || leg.mid === undefined || leg.open_interest === undefined) continue;
      if (leg.open_interest < args.min_oi) continue;

      const strikeDelta = leg.strike - args.current_strike;
      if (args.direction === "out_and_down" && args.option_type === "put" && strikeDelta > 0) continue;
      if (args.direction === "out_and_down" && args.option_type === "call" && strikeDelta > 0) continue;
      if (args.direction === "out_and_up" && args.option_type === "call" && strikeDelta < 0) continue;
      if (args.direction === "out" && Math.abs(strikeDelta) > args.max_strike_adjust) continue;
      if (Math.abs(strikeDelta) > args.max_strike_adjust) continue;

      const stoCredit = leg.bid ?? leg.mid;
      if (!stoCredit) continue;
      const netCredit = stoCredit - btcCostPer;
      if (netCredit < args.min_net_credit) continue;

      const dteExt = daysBetween(args.current_expiry, expiry);
      const absDelta = Math.abs(leg.delta);
      const newPop = 1 - absDelta;
      const score = (netCredit / Math.max(dteExt, 1)) * newPop * 100;

      const improvements: string[] = [];
      if (netCredit > 0) improvements.push(`+$${netCredit.toFixed(2)} credit`);
      if (strikeDelta !== 0) {
        const safer =
          (args.option_type === "put" && strikeDelta < 0) ||
          (args.option_type === "call" && strikeDelta > 0);
        improvements.push(`${safer ? "safer" : "closer"} strike ${strikeDelta > 0 ? "+" : ""}${strikeDelta}`);
      }
      improvements.push(`${dteExt}d more time`);

      rolls.push({
        ticker,
        btc_cost_per: Number(btcCostPer.toFixed(2)),
        new_strike: leg.strike,
        new_expiry: expiry,
        dte_extension: dteExt,
        sto_credit_per: Number(stoCredit.toFixed(2)),
        net_credit_per: Number(netCredit.toFixed(2)),
        net_credit_total: Number((netCredit * 100 * args.qty).toFixed(2)),
        new_delta: Number(leg.delta.toFixed(4)),
        new_pop: Number(newPop.toFixed(4)),
        new_oi: leg.open_interest,
        new_iv: leg.iv,
        underlying_price: state.price,
        score: Number(score.toFixed(4)),
        improvement: improvements.join(", "),
      });
    }
  }

  rolls.sort((a, b) => b.score - a.score);
  return {
    btc_cost_per: Number(btcCostPer.toFixed(2)),
    underlying_price: state.price,
    rolls: rolls.slice(0, args.max_results),
    warnings,
  };
}
