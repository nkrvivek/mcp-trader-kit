import { z } from "zod";

export const TaxEntity = z.enum(["personal", "llc-bildof", "llc-innocore"]);
export type TaxEntity = z.infer<typeof TaxEntity>;

export const Broker = z.enum(["snaptrade", "tradestation", "ibkr-direct"]);
export type Broker = z.infer<typeof Broker>;

export const LegShape = z.enum(["naked_put", "naked_call", "naked_straddle", "naked_strangle"]);

export const ProfileSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "lowercase-kebab"),
  broker: Broker,
  account_id: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "account_id must be a valid UUID"
  ),
  tax_entity: TaxEntity,
  caps: z.object({
    max_order_notional: z.number().nonnegative(),
    max_single_name_pct: z.number().min(0).max(100),
    forbidden_tools: z.array(z.string()).default([]),
    forbidden_leg_shapes: z.array(LegShape).default([]),
  }),
  vault_link: z.string().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;
