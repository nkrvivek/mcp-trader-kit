import { z } from "zod";
import { secSearchFilings, type SecActivistFiling } from "../clients/sec-edgar-client.js";
import { KNOWN_FUNDS } from "./inst-holdings.js";
import { TickerSchema } from "../utils/schemas.js";

// Known activist/event-driven funds — extension of KNOWN_FUNDS w/ activist-specific CIKs.
// Verified via SEC submissions API 2026-04-19. Entries removed where CIK resolved
// to a wrong/unrelated entity (hindenburg, cevian, engine_no1, jana, blueharbour,
// standard_general, corvex). `ackman` removed as duplicate of `pershing`.
export const KNOWN_ACTIVISTS: Record<string, { cik: string; full_name: string; style: string }> = {
  pershing:     { cik: "0001336528", full_name: "Pershing Square Capital Mgmt (Ackman)",  style: "concentrated-activist" },
  icahn:        { cik: "0000921669", full_name: "Icahn Capital LP (Carl Icahn)",          style: "hard-activist" },
  elliott:      { cik: "0001791786", full_name: "Elliott Investment Management LP",       style: "constructivist" },
  starboard:    { cik: "0001517137", full_name: "Starboard Value LP",                     style: "hard-activist" },
  third_point:  { cik: "0001040273", full_name: "Third Point LLC (Loeb)",                 style: "event-driven" },
  trian:        { cik: "0001345471", full_name: "Trian Fund Management LP (Peltz)",       style: "operational-activist" },
  valueact:     { cik: "0001418814", full_name: "ValueAct Holdings LP",                   style: "collaborative-activist" },
};

export const TrackActivistsArgs = z.object({
  mode: z.enum(["by_ticker", "by_fund", "recent", "list_activists"]),
  ticker: TickerSchema.optional(),
  fund: z.string().optional(),
  cik: z.string().regex(/^\d{1,10}$/, "CIK must be 1-10 digits; server pads to 10").optional(),
  days_back: z.number().int().positive().max(1095).default(90),
  forms: z.array(z.enum(["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A", "DEF 14A", "PREC14A"])).nonempty().default(["SC 13D", "SC 13D/A"]),
  top: z.number().int().positive().max(100).default(25),
});

type Args = z.infer<typeof TrackActivistsArgs>;

interface Result {
  mode: string;
  filters: { forms: string[]; start_date: string; end_date: string };
  total_filings: number;
  filings: SecActivistFiling[];
  interpretation: string[];
}

interface ListResult {
  mode: "list_activists";
  activists: Array<{ key: string; full_name: string; cik: string; style: string }>;
}

export async function trackActivistsHandler(args: unknown): Promise<unknown> {
  const parsed = TrackActivistsArgs.parse(args);
  return await compute(parsed);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function compute(args: Args): Promise<Result | ListResult> {
  if (args.mode === "list_activists") {
    return {
      mode: "list_activists",
      activists: Object.entries(KNOWN_ACTIVISTS).map(([key, v]) => ({
        key, full_name: v.full_name, cik: v.cik, style: v.style,
      })),
    };
  }

  const end_date = new Date().toISOString().slice(0, 10);
  const start_date = isoDaysAgo(args.days_back);

  let query = `"${args.forms[0]!}"`;
  if (args.mode === "by_ticker") {
    if (!args.ticker) throw new Error("ticker required for mode=by_ticker");
    query = args.ticker.toUpperCase();
  } else if (args.mode === "by_fund") {
    let cik = args.cik;
    let fundName = "";
    if (args.fund) {
      const key = args.fund.toLowerCase().replace(/[\s\-.]/g, "_");
      const match = KNOWN_ACTIVISTS[key]
        ?? KNOWN_FUNDS[key]
        ?? Object.entries({ ...KNOWN_ACTIVISTS, ...KNOWN_FUNDS }).find(([k, v]) =>
          k.includes(key) || v.full_name.toLowerCase().includes(key),
        )?.[1];
      if (match) { cik = match.cik; fundName = match.full_name; }
    }
    if (!cik) throw new Error(`fund "${args.fund}" not in KNOWN_ACTIVISTS; pass cik=<10-digit> or use list_activists`);
    query = `"${cik.replace(/^0+/, "").padStart(10, "0")}"`;
    // EDGAR FTS query by CIK-as-string may miss — better: search by fund name
    if (fundName) query = fundName.split(/[(,]/)[0]!.trim();
  }

  const filings = await secSearchFilings({
    query,
    forms: args.forms,
    start_date,
    end_date,
    limit: args.top,
  });

  const interpretation: string[] = [];
  interpretation.push(`${filings.length} ${args.forms.join("/")} filing${filings.length === 1 ? "" : "s"} in last ${args.days_back}d`);

  // Flag high-signal filings
  const dFilings = filings.filter((f) => f.form.includes("13D") && !f.form.includes("/A"));
  if (dFilings.length) {
    interpretation.push(`${dFilings.length} fresh 13D (activist intent) — priority review`);
  }
  const recentTickers = new Set<string>();
  filings.slice(0, 10).forEach((f) => f.subject_tickers.forEach((t) => recentTickers.add(t)));
  if (recentTickers.size) {
    interpretation.push(`recent subject tickers: ${[...recentTickers].slice(0, 10).join(", ")}`);
  }
  const knownActivistCiks = new Set(Object.values(KNOWN_ACTIVISTS).map((v) => v.cik.replace(/^0+/, "")));
  const trackedFilings = filings.filter((f) =>
    f.filer_ciks.some((c) => knownActivistCiks.has(c.replace(/^0+/, ""))),
  );
  if (trackedFilings.length) {
    const names = new Set(trackedFilings.flatMap((f) => f.filer_names));
    interpretation.push(`tracked activist match: ${[...names].slice(0, 5).join(", ")}`);
  }

  return {
    mode: args.mode,
    filters: { forms: args.forms, start_date, end_date },
    total_filings: filings.length,
    filings,
    interpretation,
  };
}
