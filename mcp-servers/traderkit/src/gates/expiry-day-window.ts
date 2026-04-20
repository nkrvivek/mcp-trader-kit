import { type Profile, DEFAULT_RULES } from "../profiles/schema.js";
import type { GateResult } from "./caps.js";

export interface ExpiryWindowInput {
  profile: Profile;
  now: Date;
  expiry_date?: string | undefined;
  direction: string;
  leg_shape?: string | undefined;
}

function parseHHMMToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function utcMinutes(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function checkExpiryDayWindow(input: ExpiryWindowInput): GateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const rules = input.profile.rules ?? DEFAULT_RULES;

  if (!rules.R1_expiry_day_window) return { pass: true, reasons, warnings };
  if (!input.expiry_date) {
    if (rules.strict_mode) reasons.push("R1: expiry_date required in strict_mode");
    return { pass: reasons.length === 0, reasons, warnings };
  }

  const todayIso = input.now.toISOString().slice(0, 10);
  if (input.expiry_date !== todayIso) return { pass: true, reasons, warnings };

  const isShortOpen = input.direction === "SELL_TO_OPEN" ||
    (input.leg_shape ?? "").startsWith("naked_");
  if (!isShortOpen) return { pass: true, reasons, warnings };

  const nowMin = utcMinutes(input.now);
  const startMin = parseHHMMToMinutes(rules.expiry_day_window_start_utc);
  const endMin = parseHHMMToMinutes(rules.expiry_day_window_end_utc);

  if (nowMin >= startMin && nowMin < endMin) {
    reasons.push(
      `R1: no new short legs on expiry day ${input.expiry_date} between ${rules.expiry_day_window_start_utc}Z and ${rules.expiry_day_window_end_utc}Z (now ${input.now.toISOString().slice(11, 16)}Z)`
    );
  }

  return { pass: reasons.length === 0, reasons, warnings };
}
