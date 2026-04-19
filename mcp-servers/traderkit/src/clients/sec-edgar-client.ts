// Minimal SEC EDGAR 13F-HR client. No external deps.
// Per SEC fair-use: User-Agent must include contact email.

import { toMessage } from "../utils/errors.js";

const SEC_UA = process.env.SEC_USER_AGENT ?? "traderkit-mcp research (contact: nkrvivek@gmail.com)";

export interface Sec13FHolding {
  ticker: string;
  cusip: string;
  name_of_issuer: string;
  value_usd: number;
  shares: number;
  put_call?: "PUT" | "CALL" | undefined;
  report_date: string;
  accession: string;
}

async function secGet(url: string, accept = "application/json"): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": SEC_UA, Accept: accept } });
  if (!res.ok) throw new Error(`SEC ${res.status} ${url.split("/").slice(-2).join("/")}`);
  return res;
}

export async function secLatest13FAccession(cik: string): Promise<{ accession: string; report_date: string } | null> {
  const padded = cik.replace(/^0+/, "").padStart(10, "0");
  try {
    const res = await secGet(`https://data.sec.gov/submissions/CIK${padded}.json`);
    const data = (await res.json()) as {
      filings?: { recent?: { form?: string[]; accessionNumber?: string[]; reportDate?: string[] } };
    };
    const r = data.filings?.recent;
    if (!r?.form) return null;
    for (let i = 0; i < r.form.length; i++) {
      if (r.form[i] === "13F-HR" && r.accessionNumber && r.reportDate) {
        return { accession: r.accessionNumber[i] ?? "", report_date: r.reportDate[i] ?? "" };
      }
    }
    return null;
  } catch (e) {
    process.stderr.write(`traderkit: secLatest13FAccession(${padded}) failed: ${toMessage(e)}\n`);
    return null;
  }
}

async function findInfoTableUrl(cikNoLeading: string, accessionNoDashes: string): Promise<string | null> {
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cikNoLeading}/${accessionNoDashes}/`;
  try {
    const res = await secGet(baseUrl, "text/html");
    const html = await res.text();
    const xmlNames: string[] = [];
    const hrefRe = /href="([^"]+\.xml)"/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(html)) !== null) {
      const name = m[1]!.split("/").pop()!;
      if (!/primary_doc/i.test(name)) xmlNames.push(name);
    }
    // Prefer largest-numeric-named xml (info tables are typically numeric like "50240.xml")
    const named = xmlNames.find((n) => /infotable|form13f/i.test(n));
    const pick = named ?? xmlNames[0];
    if (!pick) return null;
    return `${baseUrl}${pick}`;
  } catch (e) {
    process.stderr.write(`traderkit: findInfoTableUrl failed: ${toMessage(e)}\n`);
    return null;
  }
}

function stripNs(s: string): string {
  return s.replace(/<(\/?)(?:ns\d*|n1|\w+:)/g, "<$1");
}

function parseInfoTableXml(xml: string, reportDate: string, accession: string): Sec13FHolding[] {
  const normalized = stripNs(xml);
  const out: Sec13FHolding[] = [];
  const infoTableRe = /<infoTable>([\s\S]*?)<\/infoTable>/gi;
  let m: RegExpExecArray | null;
  while ((m = infoTableRe.exec(normalized)) !== null) {
    const block = m[1]!;
    const pick = (tag: string): string | undefined => {
      const mm = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i").exec(block);
      return mm?.[1]?.trim();
    };
    const name = pick("nameOfIssuer");
    const cusip = pick("cusip");
    const value = pick("value");
    const shares = pick("sshPrnamt");
    const putCallRaw = pick("putCall");
    if (!name || !cusip) continue;
    // Post-2023 13F filings report "value" in whole USD. Pre-2023 was thousands.
    // Heuristic: if report_date >= 2023-01-01, treat raw; else multiply by 1000.
    const valueRaw = Number(value ?? 0);
    const isNewFmt = reportDate >= "2023-01-01";
    const value_usd = isNewFmt ? valueRaw : valueRaw * 1000;
    const putCall = /^PUT$/i.test(putCallRaw ?? "") ? "PUT" : /^CALL$/i.test(putCallRaw ?? "") ? "CALL" : undefined;
    out.push({
      ticker: "", // resolved via CUSIP→ticker mapping if needed (not in standard 13F)
      cusip,
      name_of_issuer: name,
      value_usd,
      shares: Number(shares ?? 0),
      put_call: putCall,
      report_date: reportDate,
      accession,
    });
  }
  return out;
}

export async function secFundHoldings(cik: string): Promise<Sec13FHolding[]> {
  const padded = cik.replace(/^0+/, "").padStart(10, "0");
  const cikNoLeading = padded.replace(/^0+/, "");
  const latest = await secLatest13FAccession(padded);
  if (!latest) return [];
  const accessionNoDashes = latest.accession.replace(/-/g, "");
  const infoUrl = await findInfoTableUrl(cikNoLeading, accessionNoDashes);
  if (!infoUrl) return [];
  try {
    const res = await secGet(infoUrl, "application/xml");
    const xml = await res.text();
    return parseInfoTableXml(xml, latest.report_date, latest.accession);
  } catch (e) {
    process.stderr.write(`traderkit: secFundHoldings(${padded}) parse failed: ${toMessage(e)}\n`);
    return [];
  }
}
