import { z } from "zod";
import { tsQuotes } from "../clients/ts-client.js";

export const TsQuotesArgs = z.object({
  symbols: z.array(z.string().min(1)).min(1).max(50),
});

export async function tsQuotesHandler(rawArgs: unknown): Promise<unknown> {
  const { symbols } = TsQuotesArgs.parse(rawArgs);
  const quotes = await tsQuotes(symbols);
  return { count: quotes.length, quotes };
}
