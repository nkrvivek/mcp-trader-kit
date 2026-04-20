import { type Profile, DEFAULT_RULES } from "../profiles/schema.js";
import type { GateResult } from "./caps.js";
import { checkStale } from "../utils/freshness.js";

export interface StrikeGridEntry {
  strike: number;
  premium: number;
  delta: number;
  notes?: string | undefined;
}

export interface StrikeGridInput {
  profile: Profile;
  direction: string;
  leg_shape?: string | undefined;
  selected_strike?: number | undefined;
  strike_grid?: StrikeGridEntry[] | undefined;
  grid_as_of?: string | undefined;
  now?: Date | undefined;
  is_wheel_assignment_leg?: boolean | undefined;
}

function yieldPerDelta(e: StrikeGridEntry): number {
  const d = Math.abs(e.delta);
  return d === 0 ? 0 : e.premium / d;
}

export function checkStrikeGrid(input: StrikeGridInput): GateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const rules = input.profile.rules ?? DEFAULT_RULES;

  if (!rules.R2_strike_grid) return { pass: true, reasons, warnings };

  const isShortOpen = input.direction === "SELL_TO_OPEN" ||
    (input.leg_shape ?? "").startsWith("naked_");
  if (!isShortOpen) return { pass: true, reasons, warnings };

  if (input.is_wheel_assignment_leg) {
    warnings.push("R2: wheel-assignment intent — strike grid skipped (explicit opt-out)");
    return { pass: true, reasons, warnings };
  }

  if (!input.strike_grid || input.strike_grid.length < 3) {
    reasons.push("R2: strike_grid required (≥3 adjacent strikes) for every short-open");
    return { pass: false, reasons, warnings };
  }

  const now = input.now ?? new Date();
  const staleness = checkStale("strike_grid", input.grid_as_of, rules.quote_ttl_sec, now);
  if (staleness.stale) reasons.push(`R2: ${staleness.detail}`);

  if (input.selected_strike !== undefined) {
    const selected = input.strike_grid.find((e) => e.strike === input.selected_strike);
    if (!selected) {
      warnings.push(`R2: selected strike ${input.selected_strike} not in grid`);
    } else {
      const best = [...input.strike_grid].sort((a, b) => yieldPerDelta(b) - yieldPerDelta(a))[0]!;
      const selYield = yieldPerDelta(selected);
      const bestYield = yieldPerDelta(best);
      if (best.strike !== selected.strike && bestYield > selYield * 1.25) {
        reasons.push(
          `R2: selected $${selected.strike} (yield/Δ $${selYield.toFixed(2)}) materially worse than $${best.strike} (yield/Δ $${bestYield.toFixed(2)}, ${((bestYield / selYield - 1) * 100).toFixed(0)}% better)`
        );
      }
    }
  }

  return { pass: reasons.length === 0, reasons, warnings };
}
