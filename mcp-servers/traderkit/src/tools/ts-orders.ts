import { z } from "zod";
import { tsOrders } from "../clients/ts-client.js";

export const TsOrdersArgs = z.object({
  account_ids: z.array(z.string().min(1)).min(1),
});

export async function tsOrdersHandler(rawArgs: unknown): Promise<unknown> {
  const { account_ids } = TsOrdersArgs.parse(rawArgs);
  const orders = await tsOrders(account_ids);
  return { count: orders.length, orders };
}
