import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TickerSchema, IsoDateSchema } from "../utils/schemas.js";

function getLocalSessionsDir(): string {
  const root = process.env.TRADERKIT_HOME ?? join(homedir(), ".traderkit");
  return join(root, "sessions");
}

const ExecutedTrade = z.object({
  ticker: TickerSchema,
  direction: z.string().min(1),
  qty: z.number(),
  price: z.number(),
  broker: z.string().min(1),
  order_id: z.string().optional(),
  thesis_ref: z.string().optional(),
});

const DeferredTrade = z.object({
  ticker: TickerSchema,
  direction: z.string().min(1),
  reason: z.string().min(1),
  tag: z.string().default("deferred"),
});

const NoTradeEntry = z.object({
  ticker: TickerSchema,
  reason: z.string().min(1),
});

export const SessionWriteArgs = z.object({
  action: z.enum([
    "format_executed",
    "format_deferred",
    "format_no_trade",
    "format_session_index_row",
    "save",
  ]),
  session_id: z.string().min(1).optional(),
  date: IsoDateSchema.optional(),
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
  // `save` action
  profile: z.string().min(1).optional(),
  markdown_body: z.string().optional().describe("Full formatted session doc markdown"),
  payload: z.record(z.string(), z.unknown()).optional().describe("Structured session payload (JSON-serializable)"),
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

    case "save": {
      const profile = args.profile ?? args.book ?? "session";
      const mode = args.mode ?? "interactive";
      const now = new Date();
      const datePart = args.date ?? now.toISOString().slice(0, 10);
      const timePart = now.toISOString().slice(11, 19).replace(/:/g, "");
      const sessionId = args.session_id ?? `${datePart}-${profile}-${mode}-${timePart}`;
      const localRoot = getLocalSessionsDir();
      const dir = join(localRoot, datePart);

      try {
        mkdirSync(dir, { recursive: true });
      } catch (e) {
        return { error: `mkdir failed: ${(e as Error).message}` };
      }

      const slug = `${profile}-${mode}-${timePart}`;
      const jsonPath = join(dir, `${slug}.json`);
      const mdPath = join(dir, `${slug}.md`);

      const jsonBody = JSON.stringify(
        {
          session_id: sessionId,
          profile,
          mode,
          date: datePart,
          trigger: args.trigger ?? "ad-hoc",
          nav: args.nav,
          regime_tier: args.regime_tier,
          signal_count: args.signal_count,
          proposal_count: args.proposal_count,
          executed_count: args.executed_count,
          deferred_count: args.deferred_count,
          executed: args.executed ?? [],
          deferred: args.deferred ?? [],
          no_trades: args.no_trades ?? [],
          payload: args.payload ?? {},
          saved_at: now.toISOString(),
        },
        null,
        2,
      );

      const md =
        args.markdown_body ??
        [
          `---`,
          `session_id: ${sessionId}`,
          `profile: ${profile}`,
          `mode: ${mode}`,
          `date: ${datePart}`,
          `nav: ${args.nav ?? ""}`,
          `regime: ${args.regime_tier ?? ""}`,
          `---`,
          ``,
          `# ${profile} · ${mode} · ${datePart}`,
          ``,
          `## Executed`,
          formatExecuted(args.executed ?? []),
          ``,
          `## Deferred`,
          formatDeferred(args.deferred ?? []),
          ``,
          `## No-trade`,
          formatNoTrade(args.no_trades ?? []),
          ``,
        ].join("\n");

      try {
        writeFileSync(jsonPath, jsonBody + "\n", "utf8");
        writeFileSync(mdPath, md + "\n", "utf8");
      } catch (e) {
        return { error: `write failed: ${(e as Error).message}` };
      }

      return {
        session_id: sessionId,
        json_path: jsonPath,
        md_path: mdPath,
        local_root: localRoot,
      };
    }
  }
}
