import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TtlCache } from "../cache.js";
import { ACTIVITIES_CACHE_TTL_MS } from "../config.js";

export interface Activity {
  symbol: string;
  underlying_symbol?: string;
  action: "BUY" | "SELL";
  quantity: number;
  price: number;
  realized_pnl?: number;
  trade_date: string;
  account_id: string;
}

export interface SnaptradeReadClient {
  getActivities(accountIds: string[], since: Date): Promise<Activity[]>;
  close(): Promise<void>;
}

export interface ClientDeps {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export async function connectSnaptradeRead(deps: ClientDeps): Promise<SnaptradeReadClient> {
  const serverParams: StdioServerParameters = { command: deps.command, args: deps.args };
  if (deps.env !== undefined) serverParams.env = deps.env;

  const transport = new StdioClientTransport(serverParams);
  const client = new Client({ name: "traderkit", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  const cache = new TtlCache<Activity[]>(ACTIVITIES_CACHE_TTL_MS);

  return {
    async getActivities(accountIds, since) {
      const key = `${accountIds.sort().join(",")}|${since.toISOString()}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const result = await client.callTool({
        name: "snaptrade_get_activities",
        arguments: { account_ids: accountIds, start_date: since.toISOString().slice(0, 10) },
      });
      const rows = extractActivities(result);
      cache.set(key, rows);
      return rows;
    },
    async close() { await client.close(); },
  };
}

export function extractActivities(result: unknown): Activity[] {
  const content = (result as { content?: unknown[] })?.content ?? [];
  const textBlock = content.find((b: unknown) => (b as { type?: string }).type === "text") as { text?: string } | undefined;
  if (!textBlock?.text) return [];
  try {
    const parsed: unknown = JSON.parse(textBlock.text);
    if (Array.isArray(parsed)) return parsed as Activity[];
    if (parsed !== null && typeof parsed === "object" && "activities" in parsed && Array.isArray((parsed as { activities: unknown }).activities)) {
      return (parsed as { activities: Activity[] }).activities;
    }
    return [];
  } catch { return []; }
}
