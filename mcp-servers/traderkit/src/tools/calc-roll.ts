import { z } from "zod";
import { uwOptionChain, uwExpiryList, uwStockState } from "../clients/uw-client.js";
import { TickerSchema, IsoDateSchema } from "../utils/schemas.js";
import { daysBetween } from "../utils/date.js";
import { round } from "../utils/math.js";
import { toMessage } from "../utils/errors.js";

export const CalcRollArgs = z.object({
  ticker: TickerSchema,
  option_type: z.enum(["put", "call"]),
  current_strike: z.number().positive(),
  current_expiry: IsoDateSchema,
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

interface LegOutPlan {
  btc_price: number;
  sto_price: number;
  est_net: number;
  slippage_vs_combo: number;
  note: string;
}

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
  leg_out?: LegOutPlan | undefined;
}

export async function calcRollHandler(raw: unknown): Promise<{
  btc_cost_per?: number | undefined;
  underlying_price?: number | undefined;
  rolls: RollCandidate[];
  warnings: string[];
}> {
  const args = CalcRollArgs.parse(raw);
  const warnings: string[] = [];
  const ticker = args.ticker;

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

  const todayIso = new Date().toISOString().slice(0, 10);
  const nearDte = daysBetween(todayIso, args.current_expiry);
  const nearOi = currentLeg.open_interest ?? 0;
  const thinNearLeg = nearDte <= 1 || nearOi < 2000;
  if (thinNearLeg) {
    warnings.push(`R14: near leg thin (DTE=${nearDte}, OI=${nearOi}) — combo fill probability low, leg_out plan included per candidate`);
  }
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

  const futureChains = await Promise.all(
    futureExpiries.map((expiry) =>
      uwOptionChain(ticker, expiry)
        .then((chain) => ({ expiry, chain } as const))
        .catch((e) => {
          process.stderr.write(`traderkit: uwOptionChain(${ticker}, ${expiry}) failed: ${toMessage(e)}\n`);
          return { expiry, chain: [] } as const;
        }),
    ),
  );

  const rolls: RollCandidate[] = [];
  for (const { expiry, chain } of futureChains) {
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

      let legOut: LegOutPlan | undefined;
      if (thinNearLeg) {
        const btcPrice = round(btcCostPer);
        const stoPrice = round(stoCredit);
        const estNet = round(stoPrice - btcPrice);
        legOut = {
          btc_price: btcPrice,
          sto_price: stoPrice,
          est_net: estNet,
          slippage_vs_combo: round(estNet - round(netCredit)),
          note: `BTC near (DTE=${nearDte}, OI=${nearOi}) @ ask, STO far @ bid — two single-leg orders fill independently`,
        };
      }

      rolls.push({
        ticker,
        btc_cost_per: round(btcCostPer),
        new_strike: leg.strike,
        new_expiry: expiry,
        dte_extension: dteExt,
        sto_credit_per: round(stoCredit),
        net_credit_per: round(netCredit),
        net_credit_total: round(netCredit * 100 * args.qty),
        new_delta: round(leg.delta, 10_000),
        new_pop: round(newPop, 10_000),
        new_oi: leg.open_interest,
        new_iv: leg.iv,
        underlying_price: state.price,
        score: round(score, 10_000),
        improvement: improvements.join(", "),
        leg_out: legOut,
      });
    }
  }

  rolls.sort((a, b) => b.score - a.score);
  return {
    btc_cost_per: round(btcCostPer),
    underlying_price: state.price,
    rolls: rolls.slice(0, args.max_results),
    warnings,
  };
}
