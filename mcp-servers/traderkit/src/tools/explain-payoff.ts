import { z } from "zod";
import { round } from "../utils/math.js";

export const ExplainPayoffArgs = z.object({
  ticker: z.string().min(1).max(20),
  structure: z.enum(["covered_call", "cash_secured_put", "put_credit_spread", "call_credit_spread", "long_stock"]),
  spot: z.number().positive(),
  strike: z.number().positive().optional(),
  short_strike: z.number().positive().optional(),
  long_strike: z.number().positive().optional(),
  premium: z.number().nonnegative().optional(),
  contracts: z.number().positive().default(1),
  dte: z.number().nonnegative().optional(),
  expiry: z.string().optional(),
  shares: z.number().positive().optional(),
  cost_basis: z.number().positive().optional(),
});

type PayoffScenario = {
  condition: string;
  outcome: string;
  pnl_usd: number;
  pnl_pct_on_capital: number | null;
};

type PayoffResult = {
  ticker: string;
  structure: string;
  narrative: string[];
  scenarios: PayoffScenario[];
  breakeven: number | null;
  max_profit_usd: number | null;
  max_loss_usd: number | null;
  capital_at_risk_usd: number | null;
  prob_max_profit_note: string;
};

function fmt$(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function dteLabel(dte?: number, expiry?: string): string {
  if (expiry) return `by ${expiry}`;
  if (dte !== undefined) return `in ~${dte} days`;
  return "by expiry";
}

function coveredCall(args: z.infer<typeof ExplainPayoffArgs>): PayoffResult {
  if (args.strike === undefined || args.premium === undefined) {
    throw new Error("covered_call requires strike + premium");
  }
  const shares = args.shares ?? args.contracts * 100;
  const strike = args.strike;
  const premium = args.premium;
  const contracts = args.contracts;
  const spot = args.spot;
  const basis = args.cost_basis ?? spot;
  const when = dteLabel(args.dte, args.expiry);

  const premiumUsd = premium * 100 * contracts;
  const capitalAtRisk = shares * basis;
  const yorPct = (premiumUsd / capitalAtRisk) * 100;
  const calledAwayPnl = (strike - basis) * shares + premiumUsd;
  const breakeven = basis - premium;

  const scenarios: PayoffScenario[] = [
    {
      condition: `${args.ticker} stays ≤ ${fmt$(strike)} ${when}`,
      outcome: `Keep ${fmt$(premiumUsd)} premium + shares`,
      pnl_usd: round(premiumUsd),
      pnl_pct_on_capital: round(yorPct, 100),
    },
    {
      condition: `${args.ticker} closes > ${fmt$(strike)} ${when}`,
      outcome: `Called away at ${fmt$(strike)}; realize ${fmt$(calledAwayPnl)} vs basis ${fmt$(basis)}`,
      pnl_usd: round(calledAwayPnl),
      pnl_pct_on_capital: round((calledAwayPnl / capitalAtRisk) * 100, 100),
    },
    {
      condition: `${args.ticker} drops sharply`,
      outcome: `Still own shares; premium cushions loss down to breakeven ${fmt$(breakeven)}`,
      pnl_usd: 0,
      pnl_pct_on_capital: null,
    },
  ];

  return {
    ticker: args.ticker,
    structure: "covered_call",
    narrative: [
      `Sell ${contracts} call(s) at ${fmt$(strike)} strike against ${shares} shares.`,
      `Collect ${fmt$(premiumUsd)} up-front (${round(yorPct, 100)}% yield on ${fmt$(capitalAtRisk)} of shares at cost).`,
      `You win if ${args.ticker} stays flat or rises modestly. You cap upside above ${fmt$(strike)}.`,
      `Downside is same as owning the shares, minus the ${fmt$(premiumUsd)} cushion.`,
    ],
    scenarios,
    breakeven: round(breakeven, 100),
    max_profit_usd: round(Math.max(premiumUsd, calledAwayPnl)),
    max_loss_usd: null,
    capital_at_risk_usd: round(capitalAtRisk),
    prob_max_profit_note: `Max premium kept if ${args.ticker} finishes ≤ ${fmt$(strike)}. Rough POP ≈ 1 − call delta.`,
  };
}

function cashSecuredPut(args: z.infer<typeof ExplainPayoffArgs>): PayoffResult {
  if (args.strike === undefined || args.premium === undefined) {
    throw new Error("cash_secured_put requires strike + premium");
  }
  const strike = args.strike;
  const premium = args.premium;
  const contracts = args.contracts;
  const when = dteLabel(args.dte, args.expiry);

  const premiumUsd = premium * 100 * contracts;
  const capitalAtRisk = strike * 100 * contracts;
  const yorPct = (premiumUsd / capitalAtRisk) * 100;
  const assignedBasis = strike - premium;
  const maxLoss = (strike - premium) * 100 * contracts;

  const scenarios: PayoffScenario[] = [
    {
      condition: `${args.ticker} stays ≥ ${fmt$(strike)} ${when}`,
      outcome: `Keep ${fmt$(premiumUsd)} premium · no assignment`,
      pnl_usd: round(premiumUsd),
      pnl_pct_on_capital: round(yorPct, 100),
    },
    {
      condition: `${args.ticker} closes < ${fmt$(strike)} ${when}`,
      outcome: `Assigned ${100 * contracts} sh at ${fmt$(strike)} — net basis ${fmt$(assignedBasis)}`,
      pnl_usd: round(premiumUsd),
      pnl_pct_on_capital: round(yorPct, 100),
    },
    {
      condition: `${args.ticker} drops to $0 (worst case)`,
      outcome: `Own shares at ${fmt$(assignedBasis)} worthless → loss ${fmt$(-maxLoss)}`,
      pnl_usd: -round(maxLoss),
      pnl_pct_on_capital: -100,
    },
  ];

  return {
    ticker: args.ticker,
    structure: "cash_secured_put",
    narrative: [
      `Sell ${contracts} put(s) at ${fmt$(strike)} strike; set aside ${fmt$(capitalAtRisk)} cash as collateral.`,
      `Collect ${fmt$(premiumUsd)} up-front (${round(yorPct, 100)}% yield on collateral).`,
      `You win if ${args.ticker} stays flat or rises. If assigned, you own shares at ${fmt$(assignedBasis)} basis — lower than today's spot ${fmt$(args.spot)}.`,
      `Breakeven on assignment: ${fmt$(assignedBasis)}. Max loss only if stock goes to zero.`,
    ],
    scenarios,
    breakeven: round(assignedBasis, 100),
    max_profit_usd: round(premiumUsd),
    max_loss_usd: round(maxLoss),
    capital_at_risk_usd: round(capitalAtRisk),
    prob_max_profit_note: `Rough POP ≈ 1 − put delta. Higher strike (closer to ATM) = more premium, higher assignment risk.`,
  };
}

function putCreditSpread(args: z.infer<typeof ExplainPayoffArgs>): PayoffResult {
  if (args.short_strike === undefined || args.long_strike === undefined || args.premium === undefined) {
    throw new Error("put_credit_spread requires short_strike + long_strike + premium (net credit)");
  }
  if (args.long_strike >= args.short_strike) {
    throw new Error("put_credit_spread: long_strike must be below short_strike");
  }
  const shortK = args.short_strike;
  const longK = args.long_strike;
  const netCredit = args.premium;
  const contracts = args.contracts;
  const when = dteLabel(args.dte, args.expiry);

  const creditUsd = netCredit * 100 * contracts;
  const width = shortK - longK;
  const maxLossUsd = (width - netCredit) * 100 * contracts;
  const breakeven = shortK - netCredit;
  const rrRatio = creditUsd / maxLossUsd;

  const scenarios: PayoffScenario[] = [
    {
      condition: `${args.ticker} closes ≥ ${fmt$(shortK)} ${when}`,
      outcome: `Both legs expire worthless · keep ${fmt$(creditUsd)} credit`,
      pnl_usd: round(creditUsd),
      pnl_pct_on_capital: round((creditUsd / maxLossUsd) * 100, 100),
    },
    {
      condition: `${args.ticker} closes btw ${fmt$(longK)} and ${fmt$(shortK)}`,
      outcome: `Partial loss · short put ITM, long put cushions`,
      pnl_usd: 0,
      pnl_pct_on_capital: null,
    },
    {
      condition: `${args.ticker} closes ≤ ${fmt$(longK)} ${when}`,
      outcome: `Max loss · both ITM, width - credit`,
      pnl_usd: -round(maxLossUsd),
      pnl_pct_on_capital: -100,
    },
  ];

  return {
    ticker: args.ticker,
    structure: "put_credit_spread",
    narrative: [
      `Sell ${shortK} put, buy ${longK} put (same expiry). Collect net ${fmt$(creditUsd)} credit.`,
      `Defined risk: max loss ${fmt$(maxLossUsd)} if ${args.ticker} closes ≤ ${fmt$(longK)} ${when}.`,
      `Reward/risk: ${round(rrRatio, 100)}:1. You win if ${args.ticker} stays ≥ ${fmt$(shortK)}.`,
      `Breakeven: ${fmt$(breakeven)}. Collateral required: ${fmt$(width * 100 * contracts)}.`,
    ],
    scenarios,
    breakeven: round(breakeven, 100),
    max_profit_usd: round(creditUsd),
    max_loss_usd: round(maxLossUsd),
    capital_at_risk_usd: round(width * 100 * contracts),
    prob_max_profit_note: `Rough POP ≈ 1 − short-put delta. Tighter width = lower max loss but lower POP improvement.`,
  };
}

function callCreditSpread(args: z.infer<typeof ExplainPayoffArgs>): PayoffResult {
  if (args.short_strike === undefined || args.long_strike === undefined || args.premium === undefined) {
    throw new Error("call_credit_spread requires short_strike + long_strike + premium");
  }
  if (args.long_strike <= args.short_strike) {
    throw new Error("call_credit_spread: long_strike must be above short_strike");
  }
  const shortK = args.short_strike;
  const longK = args.long_strike;
  const netCredit = args.premium;
  const contracts = args.contracts;
  const when = dteLabel(args.dte, args.expiry);

  const creditUsd = netCredit * 100 * contracts;
  const width = longK - shortK;
  const maxLossUsd = (width - netCredit) * 100 * contracts;
  const breakeven = shortK + netCredit;

  const scenarios: PayoffScenario[] = [
    {
      condition: `${args.ticker} closes ≤ ${fmt$(shortK)} ${when}`,
      outcome: `Both legs expire worthless · keep ${fmt$(creditUsd)} credit`,
      pnl_usd: round(creditUsd),
      pnl_pct_on_capital: round((creditUsd / maxLossUsd) * 100, 100),
    },
    {
      condition: `${args.ticker} closes btw ${fmt$(shortK)} and ${fmt$(longK)}`,
      outcome: `Partial loss · short call ITM, long call caps loss`,
      pnl_usd: 0,
      pnl_pct_on_capital: null,
    },
    {
      condition: `${args.ticker} closes ≥ ${fmt$(longK)} ${when}`,
      outcome: `Max loss · both ITM`,
      pnl_usd: -round(maxLossUsd),
      pnl_pct_on_capital: -100,
    },
  ];

  return {
    ticker: args.ticker,
    structure: "call_credit_spread",
    narrative: [
      `Sell ${shortK} call, buy ${longK} call (same expiry). Collect net ${fmt$(creditUsd)} credit.`,
      `Defined risk: max loss ${fmt$(maxLossUsd)} if ${args.ticker} closes ≥ ${fmt$(longK)} ${when}.`,
      `Bearish-neutral. You win if ${args.ticker} stays ≤ ${fmt$(shortK)}.`,
      `Breakeven: ${fmt$(breakeven)}. Collateral required: ${fmt$(width * 100 * contracts)}.`,
    ],
    scenarios,
    breakeven: round(breakeven, 100),
    max_profit_usd: round(creditUsd),
    max_loss_usd: round(maxLossUsd),
    capital_at_risk_usd: round(width * 100 * contracts),
    prob_max_profit_note: `Rough POP ≈ 1 − short-call delta.`,
  };
}

function longStock(args: z.infer<typeof ExplainPayoffArgs>): PayoffResult {
  const shares = args.shares ?? 100;
  const basis = args.cost_basis ?? args.spot;
  const capital = shares * basis;

  return {
    ticker: args.ticker,
    structure: "long_stock",
    narrative: [
      `Buy ${shares} shares of ${args.ticker} at ${fmt$(basis)}. Total: ${fmt$(capital)}.`,
      `You make $1 per share for every $1 ${args.ticker} rises above ${fmt$(basis)}.`,
      `You lose $1 per share for every $1 ${args.ticker} falls below ${fmt$(basis)}.`,
      `No defined expiry. No leverage. Max loss: ${fmt$(capital)} if stock goes to zero.`,
    ],
    scenarios: [
      { condition: `${args.ticker} rises 10%`, outcome: `+${fmt$(0.1 * capital)}`, pnl_usd: round(0.1 * capital), pnl_pct_on_capital: 10 },
      { condition: `${args.ticker} flat`, outcome: `breakeven`, pnl_usd: 0, pnl_pct_on_capital: 0 },
      { condition: `${args.ticker} drops 20%`, outcome: `${fmt$(-0.2 * capital)}`, pnl_usd: -round(0.2 * capital), pnl_pct_on_capital: -20 },
    ],
    breakeven: round(basis, 100),
    max_profit_usd: null,
    max_loss_usd: round(capital),
    capital_at_risk_usd: round(capital),
    prob_max_profit_note: "No cap on upside; no time decay.",
  };
}

export async function explainPayoffHandler(raw: unknown) {
  const args = ExplainPayoffArgs.parse(raw);

  switch (args.structure) {
    case "covered_call":        return coveredCall(args);
    case "cash_secured_put":    return cashSecuredPut(args);
    case "put_credit_spread":   return putCreditSpread(args);
    case "call_credit_spread":  return callCreditSpread(args);
    case "long_stock":          return longStock(args);
  }
}
