import { z } from "zod";

export const ReconcileReminderArgs = z.object({
  broker: z.string().min(1),
  order_count: z.number().int().nonnegative(),
  session_at: z.string(),
  last_reconcile_at: z.string().optional(),
  now: z.string().optional(),
  sla_hours: z.number().positive().default(24),
  flex_query_id: z.string().regex(/^\d{1,12}$/, "flex_query_id must be 1–12 digits").optional(),
});

export type ReconcileReminderResult = {
  reminder: boolean;
  broker: string;
  hours_since_session: number;
  hours_since_reconcile: number | null;
  sla_hours: number;
  recommendation: string;
  command: string | null;
};

export async function reconcileReminderHandler(raw: unknown): Promise<ReconcileReminderResult> {
  const args = ReconcileReminderArgs.parse(raw);
  const now = args.now ? new Date(args.now) : new Date();
  const sessionAt = new Date(args.session_at);
  const hoursSinceSession = Math.round(((now.getTime() - sessionAt.getTime()) / 3_600_000) * 10) / 10;
  const hoursSinceReconcile = args.last_reconcile_at
    ? Math.round(((now.getTime() - new Date(args.last_reconcile_at).getTime()) / 3_600_000) * 10) / 10
    : null;

  const isIBKR = /ibkr|interactive/i.test(args.broker);
  const multiLeg = args.order_count >= 2;
  const overdue = hoursSinceSession > args.sla_hours &&
    (hoursSinceReconcile === null || hoursSinceReconcile > args.sla_hours);

  const reminder = isIBKR && multiLeg && overdue;

  let rec: string;
  let cmd: string | null = null;
  if (!isIBKR) rec = "non-IBKR broker — Flex reconcile not applicable";
  else if (!multiLeg) rec = `only ${args.order_count} order(s) — R5 applies to ≥2 orders`;
  else if (!overdue) rec = `within ${args.sla_hours}h SLA — no action`;
  else {
    rec = `R5: Flex reconcile overdue (${hoursSinceSession}h since session, SLA ${args.sla_hours}h)`;
    const qid = args.flex_query_id ?? "1448871";
    cmd = `cd ~/Development/radon && .venv/bin/python3 scripts/trade_blotter/flex_query.py --json --query-id ${qid}`;
  }

  return {
    reminder,
    broker: args.broker,
    hours_since_session: hoursSinceSession,
    hours_since_reconcile: hoursSinceReconcile,
    sla_hours: args.sla_hours,
    recommendation: rec,
    command: cmd,
  };
}
