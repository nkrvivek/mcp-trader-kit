---
name: example-llc
broker: snaptrade
account_id: 00000000-0000-0000-0000-000000000000
tax_entity: llc-bildof
caps:
  max_order_notional: 5000
  max_single_name_pct: 10
  forbidden_tools: []
  forbidden_leg_shapes: [naked_put, naked_call, naked_straddle, naked_strangle]
vault_link: bildof/log.md
---

# example-llc profile
LLC partnership account. Income-tilted, no margin, no naked options. Replace `account_id` + `tax_entity` values.
