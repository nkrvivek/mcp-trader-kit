import { z } from "zod";
import { tsConfirmOrder, tsPlaceOrder, type TsPlaceOrderInput } from "../clients/ts-client.js";

const OrderTypeEnum = z.enum(["Market", "Limit", "StopMarket", "StopLimit"]);
const TradeActionEnum = z.enum([
  "BUY",
  "SELL",
  "BUYTOCOVER",
  "SELLSHORT",
  "BUYTOOPEN",
  "SELLTOOPEN",
  "BUYTOCLOSE",
  "SELLTOCLOSE",
]);
const DurationEnum = z.enum(["DAY", "GTC", "GTD", "OPG", "CLO", "IOC", "FOK"]);

export const TsPlaceOrderArgs = z.object({
  account_id: z.string().min(1),
  symbol: z.string().min(1),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "quantity must be a positive number string"),
  order_type: OrderTypeEnum,
  trade_action: TradeActionEnum,
  duration: DurationEnum.default("DAY"),
  limit_price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  stop_price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  route: z.string().optional(),
  preview_only: z.boolean().default(true),
  confirm_token: z.string().optional(),
});

const HUMAN_GATE_HINT =
  "preview_only=true returns confirmation; to actually place, set preview_only=false AND set confirm_token to the literal string 'PLACE-LIVE-ORDER' (acknowledges human approval per execution-playbook R6).";

export async function tsPlaceOrderHandler(rawArgs: unknown): Promise<unknown> {
  const args = TsPlaceOrderArgs.parse(rawArgs);
  const order: TsPlaceOrderInput = {
    AccountID: args.account_id,
    Symbol: args.symbol,
    Quantity: args.quantity,
    OrderType: args.order_type,
    TradeAction: args.trade_action,
    TimeInForce: { Duration: args.duration },
    ...(args.limit_price !== undefined ? { LimitPrice: args.limit_price } : {}),
    ...(args.stop_price !== undefined ? { StopPrice: args.stop_price } : {}),
    ...(args.route !== undefined ? { Route: args.route } : {}),
  };

  if (args.preview_only) {
    const confirm = await tsConfirmOrder(order);
    return { mode: "preview", confirm, hint: HUMAN_GATE_HINT };
  }

  if (args.confirm_token !== "PLACE-LIVE-ORDER") {
    return {
      mode: "blocked",
      reason: "missing_or_invalid_confirm_token",
      hint: HUMAN_GATE_HINT,
    };
  }

  const result = await tsPlaceOrder(order);
  return { mode: "live", result };
}
