import { z } from "zod";
import { tsBalances } from "../clients/ts-client.js";

export const TsBalancesArgs = z.object({
  account_ids: z.array(z.string().min(1)).min(1),
});

export async function tsBalancesHandler(rawArgs: unknown): Promise<unknown> {
  const { account_ids } = TsBalancesArgs.parse(rawArgs);
  const balances = await tsBalances(account_ids);
  return { count: balances.length, balances };
}
