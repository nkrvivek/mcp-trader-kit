import { describe, expect, it } from "vitest";
import { parseProfile } from "../../src/profiles/loader.js";

const VALID = `---
name: bildof
broker: snaptrade
account_id: 11111111-1111-1111-1111-111111111111
tax_entity: llc-bildof
caps:
  max_order_notional: 5000
  max_single_name_pct: 10
  forbidden_tools: []
  forbidden_leg_shapes: [naked_put]
vault_link: bildof/log.md
---

# Bildof profile
Notes...
`;

describe("parseProfile", () => {
  it("parses a valid profile", () => {
    const p = parseProfile(VALID);
    expect(p.name).toBe("bildof");
    expect(p.caps.max_order_notional).toBe(5000);
    expect(p.caps.forbidden_leg_shapes).toContain("naked_put");
    expect(p.tax_entity).toBe("llc-bildof");
  });

  it("rejects missing required field", () => {
    const bad = VALID.replace("name: bildof\n", "");
    expect(() => parseProfile(bad)).toThrow(/name/);
  });

  it("rejects unknown tax_entity", () => {
    const bad = VALID.replace("tax_entity: llc-bildof", "tax_entity: offshore");
    expect(() => parseProfile(bad)).toThrow(/tax_entity/);
  });

  it("rejects non-UUID account_id", () => {
    const bad = VALID.replace(/account_id: .+/, "account_id: not-a-uuid");
    expect(() => parseProfile(bad)).toThrow(/account_id/);
  });

  it("defaults forbidden_tools to empty array", () => {
    const min = `---
name: x
broker: snaptrade
account_id: 11111111-1111-1111-1111-111111111111
tax_entity: personal
caps: { max_order_notional: 1000, max_single_name_pct: 25 }
---
body`;
    const p = parseProfile(min);
    expect(p.caps.forbidden_tools).toEqual([]);
    expect(p.caps.forbidden_leg_shapes).toEqual([]);
  });
});
