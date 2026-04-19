import { z } from "zod";
import { fmpInstHoldersByTicker, fmpFundHoldings, type FmpInstHolder, type FmpFundHolding } from "../clients/fmp-client.js";
import { secFundHoldings } from "../clients/sec-edgar-client.js";
import { TickerSchema } from "../utils/schemas.js";

// Hand-curated CIK map for marquee institutional managers. 10-digit zero-padded.
export const KNOWN_FUNDS: Record<string, { cik: string; full_name: string; tags: string[] }> = {
  citadel:       { cik: "0001423053", full_name: "Citadel Advisors LLC",            tags: ["hedge-fund", "multi-strat"] },
  blackrock:     { cik: "0001364742", full_name: "BlackRock Inc.",                  tags: ["asset-manager", "index"] },
  vanguard:      { cik: "0000102909", full_name: "Vanguard Group Inc.",             tags: ["asset-manager", "index"] },
  statestreet:   { cik: "0000093751", full_name: "State Street Corp",               tags: ["asset-manager", "index"] },
  berkshire:     { cik: "0001067983", full_name: "Berkshire Hathaway Inc.",         tags: ["value", "buffett"] },
  bridgewater:   { cik: "0001350694", full_name: "Bridgewater Associates LP",       tags: ["hedge-fund", "macro"] },
  renaissance:   { cik: "0001037389", full_name: "Renaissance Technologies LLC",    tags: ["hedge-fund", "quant"] },
  twosigma:      { cik: "0001179392", full_name: "Two Sigma Investments LP",        tags: ["hedge-fund", "quant"] },
  point72:       { cik: "0001603466", full_name: "Point72 Asset Management LP",     tags: ["hedge-fund", "multi-strat"] },
  millennium:    { cik: "0001273087", full_name: "Millennium Management LLC",       tags: ["hedge-fund", "multi-strat"] },
  tiger_global:  { cik: "0001167483", full_name: "Tiger Global Management LLC",     tags: ["hedge-fund", "growth"] },
  pershing:      { cik: "0001336528", full_name: "Pershing Square Capital Mgmt LP", tags: ["hedge-fund", "activist", "ackman"] },
  appaloosa:     { cik: "0001006438", full_name: "Appaloosa LP (Tepper)",           tags: ["hedge-fund", "value"] },
  soros:         { cik: "0001029160", full_name: "Soros Fund Management LLC",       tags: ["hedge-fund", "macro"] },
  greenlight:    { cik: "0001079114", full_name: "Greenlight Capital Inc. (Einhorn)", tags: ["hedge-fund", "value"] },
  baupost:       { cik: "0001061768", full_name: "Baupost Group LLC (Klarman)",     tags: ["hedge-fund", "value"] },
  lone_pine:     { cik: "0001061165", full_name: "Lone Pine Capital LLC",           tags: ["hedge-fund", "long-short"] },
  viking:        { cik: "0001103804", full_name: "Viking Global Investors LP",      tags: ["hedge-fund", "long-short"] },
  coatue:        { cik: "0001135730", full_name: "Coatue Management LLC",           tags: ["hedge-fund", "tech"] },
  dfa:           { cik: "0000354204", full_name: "Dimensional Fund Advisors LP",    tags: ["asset-manager", "factor"] },
  jpmorgan:      { cik: "0001071992", full_name: "JPMorgan Chase & Co",             tags: ["bank", "asset-manager"] },
  goldman:       { cik: "0000886982", full_name: "Goldman Sachs Group Inc.",        tags: ["bank", "asset-manager"] },
  morgan_stanley:{ cik: "0000895421", full_name: "Morgan Stanley",                  tags: ["bank", "asset-manager"] },
};

export const InstHoldingsArgs = z.object({
  mode: z.enum(["by_ticker", "by_fund", "list_funds"]),
  ticker: TickerSchema.optional(),
  fund: z.string().optional(),
  cik: z.string().regex(/^\d{1,10}$/).optional(),
  top: z.number().int().positive().max(50).default(20),
});

type Args = z.infer<typeof InstHoldingsArgs>;

interface ByTickerResult {
  mode: "by_ticker";
  ticker: string;
  total_holders: number;
  top_holders: Array<FmpInstHolder & { rank: number }>;
  notable_matches: Array<{ fund_key: string; full_name: string; rank: number } & FmpInstHolder>;
  interpretation: string[];
}

interface ByFundResult {
  mode: "by_fund";
  fund_key?: string | undefined;
  fund_name: string;
  cik: string;
  source: "fmp" | "sec-edgar";
  total_positions: number;
  top_holdings: Array<FmpFundHolding & { rank: number }>;
  interpretation: string[];
}

interface ListFundsResult {
  mode: "list_funds";
  funds: Array<{ key: string; full_name: string; cik: string; tags: string[] }>;
}

export async function instHoldingsHandler(args: unknown): Promise<unknown> {
  const parsed = InstHoldingsArgs.parse(args);
  return await compute(parsed);
}

async function compute(args: Args): Promise<ByTickerResult | ByFundResult | ListFundsResult> {
  if (args.mode === "list_funds") {
    return {
      mode: "list_funds",
      funds: Object.entries(KNOWN_FUNDS).map(([key, v]) => ({ key, full_name: v.full_name, cik: v.cik, tags: v.tags })),
    };
  }

  if (args.mode === "by_ticker") {
    if (!args.ticker) throw new Error("ticker required for mode=by_ticker");
    const T = args.ticker.toUpperCase();
    const rows = await fmpInstHoldersByTicker(T);
    if (!rows.length) throw new Error(`no institutional holder data for ${T} (FMP tier may not include this endpoint)`);

    const sorted = [...rows].sort((a, b) => (b.market_value_usd ?? 0) - (a.market_value_usd ?? 0));
    const top_holders = sorted.slice(0, args.top).map((r, i) => ({ ...r, rank: i + 1 }));

    const notable_matches = matchKnownFunds(top_holders);

    const interpretation: string[] = [];
    if (top_holders.length > 0) {
      const totalMV = sorted.reduce((a, r) => a + (r.market_value_usd ?? 0), 0);
      const top5MV = sorted.slice(0, 5).reduce((a, r) => a + (r.market_value_usd ?? 0), 0);
      const conc = totalMV > 0 ? (top5MV / totalMV) * 100 : 0;
      interpretation.push(`top 5 holders = ${conc.toFixed(1)}% of tracked 13F market value`);
    }
    if (notable_matches.length) {
      const names = notable_matches.slice(0, 5).map((n) => n.full_name).join(", ");
      interpretation.push(`notable: ${names}`);
    }
    const builders = top_holders.filter((h) => (h.change_shares ?? 0) > 0).length;
    const trimmers = top_holders.filter((h) => (h.change_shares ?? 0) < 0).length;
    if (builders > trimmers * 1.5) interpretation.push(`smart-money accumulating (${builders} builders vs ${trimmers} trimmers in top ${top_holders.length})`);
    else if (trimmers > builders * 1.5) interpretation.push(`smart-money distributing (${trimmers} trimmers vs ${builders} builders in top ${top_holders.length})`);
    else interpretation.push(`smart-money balanced (${builders} builders / ${trimmers} trimmers)`);

    return {
      mode: "by_ticker",
      ticker: T,
      total_holders: rows.length,
      top_holders,
      notable_matches,
      interpretation,
    };
  }

  // mode === "by_fund"
  let cik = args.cik;
  let fundKey: string | undefined;
  let fundName = "";
  if (args.fund) {
    const key = args.fund.toLowerCase().replace(/[\s\-.]/g, "_");
    const match = KNOWN_FUNDS[key] ?? Object.entries(KNOWN_FUNDS).find(([k, v]) =>
      k.includes(key) || v.full_name.toLowerCase().includes(key),
    )?.[1];
    if (match) {
      fundKey = Object.keys(KNOWN_FUNDS).find((k) => KNOWN_FUNDS[k]!.cik === match.cik);
      cik = match.cik;
      fundName = match.full_name;
    } else if (!cik) {
      throw new Error(`fund "${args.fund}" not in KNOWN_FUNDS; pass cik=<10-digit> or use list_funds mode`);
    }
  }
  if (!cik) throw new Error("fund or cik required for mode=by_fund");

  let holdings = await fmpFundHoldings(cik);
  let source: "fmp" | "sec-edgar" = "fmp";
  if (!holdings.length) {
    const sec = await secFundHoldings(cik);
    if (sec.length) {
      source = "sec-edgar";
      holdings = sec.map((h) => ({
        ticker: h.name_of_issuer.toUpperCase().slice(0, 20),
        shares: h.shares,
        market_value_usd: h.value_usd,
        weight_pct: undefined,
        change_shares: undefined,
        change_pct: undefined,
        report_date: h.report_date,
      }));
    }
  }
  if (!holdings.length) throw new Error(`no 13F holdings for CIK ${cik} (FMP + SEC EDGAR both empty; check CIK or recent filing)`);

  const sorted = [...holdings].sort((a, b) => (b.market_value_usd ?? 0) - (a.market_value_usd ?? 0));
  const top_holdings = sorted.slice(0, args.top).map((r, i) => ({ ...r, rank: i + 1 }));

  const interpretation: string[] = [];
  const totalMV = sorted.reduce((a, r) => a + (r.market_value_usd ?? 0), 0);
  if (totalMV > 0) interpretation.push(`portfolio AUM (tracked 13F) = $${(totalMV / 1e9).toFixed(1)}B across ${sorted.length} positions`);
  const newBuilds = holdings.filter((h) => (h.change_shares ?? 0) > 0 && (h.change_pct ?? 0) > 50).map((h) => h.ticker).slice(0, 5);
  if (newBuilds.length) interpretation.push(`new/added (>50%): ${newBuilds.join(", ")}`);
  const exits = holdings.filter((h) => (h.change_pct ?? 0) < -50).map((h) => h.ticker).slice(0, 5);
  if (exits.length) interpretation.push(`trimmed/exited (<-50%): ${exits.join(", ")}`);

  return {
    mode: "by_fund",
    fund_key: fundKey,
    fund_name: fundName || `CIK ${cik}`,
    cik,
    source,
    total_positions: holdings.length,
    top_holdings,
    interpretation,
  };
}

function matchKnownFunds(holders: Array<FmpInstHolder & { rank: number }>): Array<{ fund_key: string; full_name: string; rank: number } & FmpInstHolder> {
  const out: Array<{ fund_key: string; full_name: string; rank: number } & FmpInstHolder> = [];
  for (const h of holders) {
    const name = h.holder_name.toLowerCase();
    for (const [key, v] of Object.entries(KNOWN_FUNDS)) {
      const short = v.full_name.split(/[ .,]/)[0]!.toLowerCase();
      if (name.includes(short) || (h.cik && h.cik.replace(/^0+/, "") === v.cik.replace(/^0+/, ""))) {
        out.push({ ...h, fund_key: key, full_name: v.full_name });
        break;
      }
    }
  }
  return out;
}
