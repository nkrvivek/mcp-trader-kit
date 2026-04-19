---
name: example-personal
broker: snaptrade
account_id: 00000000-0000-0000-0000-000000000000
tax_entity: personal
caps:
  max_order_notional: 10000
  max_single_name_pct: 25
  forbidden_tools: []
  forbidden_leg_shapes: [naked_put, naked_call]
---

# example-personal profile
Individual taxable brokerage account. Replace `account_id` with the UUID from `list_accounts`.
