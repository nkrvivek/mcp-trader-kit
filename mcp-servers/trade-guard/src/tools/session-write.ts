import { z } from "zod";

const ExecutedTrade = z.object({
  ticker: z.string().min(1),
  direction: z.string().min(1),
  qty: z.number(),
  price: z.number(),
  broker: z.string().min(1),
  order_id: z.string().optional(),
  thesis_ref: z.string().optional(),
});

const DeferredTrade = z.object({
  ticker: z.string().min(1),
  direction: z.string().min(1),
  reason: z.string().min(1),
  tag: z.string().default("deferred"),
});

const NoTradeEntry = z.object({
  ticker: z.string().min(1),
  reason: z.string().min(1),
});

export const SessionWriteArgs = z.object({
  action: z.enum(["format_executed", "format_deferred", "format_no_trade", "format_session_index_row"]),
  session_id: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  book: z.string().min(1).optional(),
  nav: z.number().optional(),
  regime_tier: z.string().optional(),
  signal_count: z.number().optional(),
  proposal_count: z.number().optional(),
  executed_count: z.number().optional(),
  deferred_count: z.number().optional(),
  mode: z.string().optional(),
  trigger: z.string().optional(),
  executed: z.array(ExecutedTrade).optional(),
  deferred: z.array(DeferredTrade).optional(),
  no_trades: z.array(NoTradeEntry).optional(),
});

function formatExecuted(trades: z.infer<typeof ExecutedTrade>[]): string {
  if (trades.length === 0) return "No trades executed.";
  const header = "| Ticker | Direction | Qty | Price | Broker | Order ID | Thesis |";
  const sep = "|--------|-----------|-----|-------|--------|----------|--------|";
  const rows = trades.map((t) =>
    `| ${t.ticker} | ${t.direction} | ${t.qty} | $${t.price.toFixed(2)} | ${t.broker} | ${t.order_id ?? "—"} | ${t.thesis_ref ?? "—"} |`
  );
  return [header, sep, ...rows].join("\n");
}

function formatDeferred(trades: z.infer<typeof DeferredTrade>[]): string {
  if (trades.length === 0) return "No deferred trades.";
  return trades
    .map((t) => `- **${t.ticker}** ${t.direction} — ${t.reason} [${t.tag.toUpperCase()} ▷]`)
    .join("\n");
}

function formatNoTrade(entries: z.infer<typeof NoTradeEntry>[]): string {
  if (entries.length === 0) return "No rejected tickers.";
  return entries
    .map((e) => `- **${e.ticker}** — ${e.reason}`)
    .join("\n");
}

function formatSessionIndexRow(args: {
  date: string;
  book: string;
  session_id: string;
  nav: number;
  regime_tier: string;
  signal_count: number;
  proposal_count: number;
  executed_count: number;
  deferred_count: number;
  mode: string;
  trigger: string;
}): string {
  return `| ${args.date} | ${args.book} | ${args.session_id} | $${args.nav.toLocaleString()} | ${args.regime_tier} | ${args.signal_count} | ${args.proposal_count} | ${args.executed_count} | ${args.deferred_count} | ${args.mode} | ${args.trigger} |`;
}

export async function sessionWriteHandler(raw: unknown) {
  const args = SessionWriteArgs.parse(raw);

  switch (args.action) {
    case "format_executed":
      return { markdown: formatExecuted(args.executed ?? []) };

    case "format_deferred":
      return { markdown: formatDeferred(args.deferred ?? []) };

    case "format_no_trade":
      return { markdown: formatNoTrade(args.no_trades ?? []) };

    case "format_session_index_row": {
      if (!args.date || !args.book || !args.session_id || args.nav === undefined || !args.regime_tier) {
        return { error: "date, book, session_id, nav, regime_tier required for format_session_index_row" };
      }
      return {
        row: formatSessionIndexRow({
          date: args.date,
          book: args.book,
          session_id: args.session_id,
          nav: args.nav,
          regime_tier: args.regime_tier,
          signal_count: args.signal_count ?? 0,
          proposal_count: args.proposal_count ?? 0,
          executed_count: args.executed_count ?? 0,
          deferred_count: args.deferred_count ?? 0,
          mode: args.mode ?? "interactive",
          trigger: args.trigger ?? "ad-hoc",
        }),
      };
    }
  }
}
