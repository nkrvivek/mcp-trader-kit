import { z } from "zod";

const ExpiringLeg = z.object({
  leg_id: z.string().min(1),
  ticker: z.string().min(1),
  option_type: z.enum(["CALL", "PUT"]),
  strike: z.number().positive(),
  side: z.enum(["SHORT", "LONG"]),
  expiry_date: z.string(),
  underlying_price: z.number().nonnegative(),
});

const NewCycleLeg = z.object({
  leg_id: z.string().min(1),
  ticker: z.string().min(1),
  intent: z.string(),
});

export const ExpiryPriorityArgs = z.object({
  expiring_legs: z.array(ExpiringLeg).default([]),
  new_cycle_legs: z.array(NewCycleLeg).default([]),
});

type Bucket = "ITM" | "ATM" | "OTM";

function bucketOf(leg: z.infer<typeof ExpiringLeg>): Bucket {
  const s = leg.strike;
  const u = leg.underlying_price;
  const pinBand = Math.max(0.25, s * 0.01);
  if (Math.abs(u - s) <= pinBand) return "ATM";
  if (leg.option_type === "CALL") {
    return leg.side === "SHORT" ? (u > s ? "ITM" : "OTM") : (u > s ? "ITM" : "OTM");
  }
  return leg.side === "SHORT" ? (u < s ? "ITM" : "OTM") : (u < s ? "ITM" : "OTM");
}

const BUCKET_ORDER: Record<Bucket, number> = { ITM: 0, ATM: 1, OTM: 2 };

export type ExpiryPriorityResult = {
  ordered: Array<{
    step: number;
    phase: "EXPIRING_ITM" | "EXPIRING_ATM" | "EXPIRING_OTM" | "NEW_CYCLE";
    leg_id: string;
    ticker: string;
    detail: string;
  }>;
  summary: { itm: number; atm: number; otm: number; new_cycle: number };
  violations: string[];
};

export async function expiryPriorityHandler(raw: unknown): Promise<ExpiryPriorityResult> {
  const args = ExpiryPriorityArgs.parse(raw);
  const tagged = args.expiring_legs.map((l) => ({ leg: l, bucket: bucketOf(l) }));
  tagged.sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]);

  const ordered: ExpiryPriorityResult["ordered"] = [];
  let step = 1;
  for (const t of tagged) {
    const phase = (`EXPIRING_${t.bucket}` as const);
    ordered.push({
      step: step++,
      phase,
      leg_id: t.leg.leg_id,
      ticker: t.leg.ticker,
      detail: `${t.leg.side} ${t.leg.ticker} ${t.leg.strike}${t.leg.option_type[0]} exp ${t.leg.expiry_date} — underlying $${t.leg.underlying_price}, ${t.bucket}`,
    });
  }
  for (const n of args.new_cycle_legs) {
    ordered.push({
      step: step++,
      phase: "NEW_CYCLE",
      leg_id: n.leg_id,
      ticker: n.ticker,
      detail: n.intent,
    });
  }

  const summary = {
    itm: tagged.filter((t) => t.bucket === "ITM").length,
    atm: tagged.filter((t) => t.bucket === "ATM").length,
    otm: tagged.filter((t) => t.bucket === "OTM").length,
    new_cycle: args.new_cycle_legs.length,
  };

  const violations: string[] = [];
  if (summary.itm > 0 && args.new_cycle_legs.length > 0) {
    violations.push("R8: ITM expiring legs present — process roll/close decisions before new-cycle writes");
  }
  if (summary.atm > 0 && args.new_cycle_legs.length > 0) {
    violations.push("R8: ATM pin-risk legs present — decide pin risk before new-cycle writes");
  }

  return { ordered, summary, violations };
}
