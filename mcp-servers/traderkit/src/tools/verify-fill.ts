import { z } from "zod";

const LegFill = z.object({
  leg_id: z.string().min(1),
  intended_qty: z.number().int().positive(),
  filled_qty: z.number().int().nonnegative(),
  status: z.enum(["FILLED", "PARTIAL", "SUBMITTED", "CANCELLED", "REJECTED"]).optional(),
});

export const VerifyFillArgs = z.object({
  session_id: z.string().optional(),
  source: z.enum(["ib-gateway", "ib-flex", "snaptrade-list-orders", "tradestation", "manual"]),
  source_ref: z.string().optional(),
  verified_at: z.string().optional(),
  legs: z.array(LegFill).min(1),
});

export type VerifyFillResult = {
  overall_status: "executed" | "partial-fill" | "submitted-unverified" | "failed";
  total_intended: number;
  total_filled: number;
  coerced_status_label: string;
  legs: Array<{
    leg_id: string;
    intended_qty: number;
    filled_qty: number;
    fill_pct: number;
    status: string;
  }>;
  safe_to_mark_executed: boolean;
  source: string;
  source_ref?: string;
  verified_at: string;
  warnings: string[];
};

export async function verifyFillHandler(raw: unknown): Promise<VerifyFillResult> {
  const args = VerifyFillArgs.parse(raw);
  const verifiedAt = args.verified_at ?? new Date().toISOString();
  const warnings: string[] = [];

  const legs = args.legs.map((l) => ({
    leg_id: l.leg_id,
    intended_qty: l.intended_qty,
    filled_qty: l.filled_qty,
    fill_pct: l.intended_qty > 0 ? Math.round((l.filled_qty / l.intended_qty) * 1000) / 10 : 0,
    status: l.status ?? (l.filled_qty === l.intended_qty ? "FILLED" : l.filled_qty > 0 ? "PARTIAL" : "SUBMITTED"),
  }));
  const totalIntended = legs.reduce((s, l) => s + l.intended_qty, 0);
  const totalFilled = legs.reduce((s, l) => s + l.filled_qty, 0);

  const allFilled = legs.every((l) => l.status === "FILLED" && l.filled_qty === l.intended_qty);
  const anyPartial = legs.some((l) => l.status === "PARTIAL" || (l.filled_qty > 0 && l.filled_qty < l.intended_qty));
  const anySubmitted = legs.some((l) => l.status === "SUBMITTED" || (l.filled_qty === 0 && l.status !== "CANCELLED" && l.status !== "REJECTED"));

  let overall: VerifyFillResult["overall_status"];
  if (allFilled) overall = "executed";
  else if (anyPartial) overall = "partial-fill";
  else if (anySubmitted) overall = "submitted-unverified";
  else overall = "failed";

  const partialLegs = legs.filter((l) => l.filled_qty < l.intended_qty);
  const coercedLabel = overall === "executed"
    ? "executed"
    : overall === "partial-fill"
      ? `partial-fill (${totalFilled}/${totalIntended})`
      : overall === "submitted-unverified"
        ? "submitted-unverified"
        : "failed";

  if (args.source === "ib-gateway") {
    warnings.push("ib-gateway only returns current-session fills — cross-check via ib-flex within 24h (R5)");
  }
  if (partialLegs.length > 0) {
    warnings.push(`${partialLegs.length} leg(s) not fully filled: ${partialLegs.map((l) => `${l.leg_id} ${l.filled_qty}/${l.intended_qty}`).join(", ")}`);
  }

  const result: VerifyFillResult = {
    overall_status: overall,
    total_intended: totalIntended,
    total_filled: totalFilled,
    coerced_status_label: coercedLabel,
    legs,
    safe_to_mark_executed: overall === "executed",
    source: args.source,
    verified_at: verifiedAt,
    warnings,
  };
  if (args.source_ref) result.source_ref = args.source_ref;
  return result;
}
