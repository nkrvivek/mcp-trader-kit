import { z } from "zod";
import { tsPositions } from "../clients/ts-client.js";

export const TsPositionsArgs = z.object({
  account_ids: z.array(z.string().min(1)).min(1),
});

export async function tsPositionsHandler(rawArgs: unknown): Promise<unknown> {
  const { account_ids } = TsPositionsArgs.parse(rawArgs);
  const positions = await tsPositions(account_ids);
  return { count: positions.length, positions };
}
