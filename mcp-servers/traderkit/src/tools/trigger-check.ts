import { z } from "zod";

export const TriggerCheckArgs = z.object({
  current_nav: z.number().positive(),
  previous_nav: z.number().positive(),
  current_regime_tier: z.enum(["CLEAR", "CAUTION", "DEFENSIVE", "HALT"]),
  previous_regime_tier: z.enum(["CLEAR", "CAUTION", "DEFENSIVE", "HALT"]).optional(),
  positions: z.array(z.object({
    ticker: z.string().min(1),
    market_value_usd: z.number(),
  })).optional(),
  portfolio_total_usd: z.number().positive().optional(),
  concentration_cap_pct: z.number().min(0).max(100).default(25),
  nav_move_threshold_pct: z.number().min(0).default(2),
});

type Severity = "INFO" | "WARNING" | "CRITICAL";

interface TriggerEvent {
  kind: string;
  severity: Severity;
  detail: string;
}

const REGIME_SEVERITY: Record<string, number> = { CLEAR: 0, CAUTION: 1, DEFENSIVE: 2, HALT: 3 };

export async function triggerCheckHandler(raw: unknown) {
  const args = TriggerCheckArgs.parse(raw);
  const events: TriggerEvent[] = [];

  const navDelta = ((args.current_nav - args.previous_nav) / args.previous_nav) * 100;
  const navDeltaRounded = Math.round(navDelta * 100) / 100;

  if (Math.abs(navDelta) >= args.nav_move_threshold_pct) {
    const direction = navDelta > 0 ? "up" : "down";
    const severity: Severity = Math.abs(navDelta) >= args.nav_move_threshold_pct * 2 ? "CRITICAL" : "WARNING";
    events.push({
      kind: "NAV_MOVE",
      severity,
      detail: `NAV ${direction} ${Math.abs(navDeltaRounded)}% ($${args.previous_nav.toLocaleString()} → $${args.current_nav.toLocaleString()})`,
    });
  }

  if (args.previous_regime_tier && args.current_regime_tier !== args.previous_regime_tier) {
    const prev = REGIME_SEVERITY[args.previous_regime_tier]!;
    const curr = REGIME_SEVERITY[args.current_regime_tier]!;
    const direction = curr > prev ? "deteriorated" : "improved";
    const severity: Severity = curr > prev ? "CRITICAL" : "INFO";
    events.push({
      kind: "REGIME_SHIFT",
      severity,
      detail: `regime ${direction}: ${args.previous_regime_tier} → ${args.current_regime_tier}`,
    });
  }

  if (args.positions && args.portfolio_total_usd) {
    for (const pos of args.positions) {
      const pct = (pos.market_value_usd / args.portfolio_total_usd) * 100;
      if (pct > args.concentration_cap_pct) {
        const overBy = Math.round((pct - args.concentration_cap_pct) * 10) / 10;
        events.push({
          kind: "CONCENTRATION_BREACH",
          severity: overBy > 10 ? "CRITICAL" : "WARNING",
          detail: `${pos.ticker} at ${Math.round(pct * 10) / 10}% — exceeds ${args.concentration_cap_pct}% cap by ${overBy}pp`,
        });
      }
    }
  }

  events.sort((a, b) => {
    const sev: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return sev[a.severity] - sev[b.severity];
  });

  return {
    triggered: events.length > 0,
    event_count: events.length,
    events,
    nav_delta_pct: navDeltaRounded,
    regime_tier: args.current_regime_tier,
  };
}
