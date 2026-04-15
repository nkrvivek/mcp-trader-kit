import type { Profile } from "../profiles/schema.js";

export async function listProfilesHandler(
  _raw: unknown,
  deps: { allProfiles: Profile[] }
) {
  return deps.allProfiles.map((p) => ({
    name: p.name, broker: p.broker, tax_entity: p.tax_entity,
    caps_summary: `notional ≤ $${p.caps.max_order_notional}, single-name ≤ ${p.caps.max_single_name_pct}%`,
  }));
}
