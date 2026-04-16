import { z } from "zod";

export const RegimeGateArgs = z.object({
  regime_tier: z.enum(["CLEAR", "CAUTION", "DEFENSIVE", "HALT"]),
  direction: z.enum(["BUY", "SELL", "BUY_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_OPEN", "SELL_TO_CLOSE"]),
  structure: z.string().optional(),
  notional_usd: z.number().nonnegative(),
});

interface RegimeBias {
  size_multiplier: number;
  max_dte: number | null;
  preferred_structures: string[];
  blocked_actions: string[];
  warnings: string[];
}

const REGIME_BIAS: Record<string, RegimeBias> = {
  CLEAR: {
    size_multiplier: 1.0,
    max_dte: null,
    preferred_structures: ["covered_call", "cash_secured_put", "long_stock", "bull_call_spread"],
    blocked_actions: [],
    warnings: [],
  },
  CAUTION: {
    size_multiplier: 0.75,
    max_dte: 45,
    preferred_structures: ["covered_call", "collar", "bull_put_spread"],
    blocked_actions: [],
    warnings: ["regime CAUTION — reduce size, prefer defined-risk"],
  },
  DEFENSIVE: {
    size_multiplier: 0.5,
    max_dte: 30,
    preferred_structures: ["covered_call", "collar", "protective_put"],
    blocked_actions: ["BUY", "BUY_TO_OPEN"],
    warnings: ["regime DEFENSIVE — no new longs, close/roll only"],
  },
  HALT: {
    size_multiplier: 0.25,
    max_dte: 14,
    preferred_structures: ["protective_put"],
    blocked_actions: ["BUY", "BUY_TO_OPEN", "SELL_TO_OPEN"],
    warnings: ["regime HALT — exits and hedges only"],
  },
};

export async function regimeGateHandler(raw: unknown) {
  const args = RegimeGateArgs.parse(raw);
  const bias = REGIME_BIAS[args.regime_tier]!;

  const adjusted_notional = Math.round(args.notional_usd * bias.size_multiplier * 100) / 100;
  const blocked = bias.blocked_actions.includes(args.direction);
  const structure_aligned = !args.structure || bias.preferred_structures.includes(args.structure);

  const reasons: string[] = [];
  if (blocked) {
    reasons.push(`${args.direction} blocked in ${args.regime_tier} regime`);
  }

  const warnings = [...bias.warnings];
  if (!structure_aligned && args.structure) {
    warnings.push(`structure '${args.structure}' not in preferred list for ${args.regime_tier}`);
  }
  if (bias.size_multiplier < 1.0) {
    warnings.push(`size adjusted: $${args.notional_usd.toLocaleString()} → $${adjusted_notional.toLocaleString()} (${bias.size_multiplier}x multiplier)`);
  }

  return {
    pass: !blocked,
    regime_tier: args.regime_tier,
    size_multiplier: bias.size_multiplier,
    adjusted_notional_usd: adjusted_notional,
    max_dte: bias.max_dte,
    preferred_structures: bias.preferred_structures,
    structure_aligned,
    reasons,
    warnings,
  };
}
