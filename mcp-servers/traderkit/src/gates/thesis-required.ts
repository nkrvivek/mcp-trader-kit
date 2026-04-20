import { type Profile, DEFAULT_RULES } from "../profiles/schema.js";
import type { GateResult } from "./caps.js";

export interface ActiveThesis {
  thesis_id: string;
  tickers: string[];
  structures?: string[] | undefined;
  status: "active" | "paused" | "closed";
}

export interface ThesisRequiredInput {
  profile: Profile;
  ticker: string;
  thesis_ref?: string | undefined;
  discretionary_event?: boolean | undefined;
  discretionary_rationale?: string | undefined;
  active_theses?: ActiveThesis[] | undefined;
}

export function checkThesisRequired(input: ThesisRequiredInput): GateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const rules = input.profile.rules ?? DEFAULT_RULES;

  if (!rules.R7_thesis_required) return { pass: true, reasons, warnings };

  if (input.discretionary_event) {
    if (!input.discretionary_rationale || input.discretionary_rationale.trim().length < 10) {
      reasons.push("R7: discretionary_event declared but rationale missing/too short (≥10 chars)");
    }
    return { pass: reasons.length === 0, reasons, warnings };
  }

  if (!input.thesis_ref) {
    reasons.push("R7: thesis_ref required (or set discretionary_event=true w/ rationale)");
    return { pass: false, reasons, warnings };
  }

  if (!input.active_theses || input.active_theses.length === 0) {
    reasons.push("R7: active_theses list required to verify thesis status");
    return { pass: false, reasons, warnings };
  }

  const thesis = input.active_theses.find((t) => t.thesis_id === input.thesis_ref);
  if (!thesis) {
    reasons.push(`R7: thesis ${input.thesis_ref} not found in active_theses`);
    return { pass: false, reasons, warnings };
  }
  if (thesis.status !== "active") {
    reasons.push(`R7: thesis ${input.thesis_ref} status=${thesis.status} (must be active)`);
    return { pass: false, reasons, warnings };
  }

  const tickerU = input.ticker.toUpperCase();
  if (!thesis.tickers.some((t) => t.toUpperCase() === tickerU)) {
    reasons.push(`R7: ${input.ticker} not in thesis ${input.thesis_ref} tickers [${thesis.tickers.join(", ")}]`);
  }

  return { pass: reasons.length === 0, reasons, warnings };
}
