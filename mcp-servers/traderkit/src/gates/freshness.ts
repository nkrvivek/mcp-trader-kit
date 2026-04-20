import { type Profile, DEFAULT_RULES } from "../profiles/schema.js";
import type { GateResult } from "./caps.js";
import { checkStale } from "../utils/freshness.js";

export interface FreshnessInput {
  profile: Profile;
  now: Date;
  quote_as_of?: string | undefined;
  grid_as_of?: string | undefined;
  regime_as_of?: string | undefined;
  portfolio_total_as_of?: string | undefined;
  activities_as_of?: string | undefined;
  require_quote?: boolean | undefined;
  require_grid?: boolean | undefined;
  require_regime?: boolean | undefined;
  require_portfolio_total?: boolean | undefined;
  require_activities?: boolean | undefined;
}

export function checkFreshness(input: FreshnessInput): GateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const rules = input.profile.rules ?? DEFAULT_RULES;

  if (!rules.R0_no_stale_data) return { pass: true, reasons, warnings };

  const checks: Array<{
    required: boolean | undefined;
    field: string;
    value: string | undefined;
    ttl: number;
  }> = [
    { required: input.require_quote, field: "quote", value: input.quote_as_of, ttl: rules.quote_ttl_sec },
    { required: input.require_grid, field: "strike_grid", value: input.grid_as_of, ttl: rules.quote_ttl_sec },
    { required: input.require_regime, field: "regime", value: input.regime_as_of, ttl: rules.regime_ttl_sec },
    { required: input.require_portfolio_total, field: "portfolio_total", value: input.portfolio_total_as_of, ttl: rules.portfolio_total_ttl_sec },
    { required: input.require_activities, field: "activities", value: input.activities_as_of, ttl: rules.activities_ttl_sec },
  ];

  for (const c of checks) {
    if (!c.required) continue;
    const r = checkStale(c.field, c.value, c.ttl, input.now);
    if (r.stale) reasons.push(`R0: ${r.detail}`);
  }

  return { pass: reasons.length === 0, reasons, warnings };
}
