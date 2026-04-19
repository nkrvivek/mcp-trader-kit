// Minimal SEC EDGAR 13F-HR client. No external deps.
// Per SEC fair-use: User-Agent must include contact email.

import { toMessage } from "../utils/errors.js";

// SEC fair-use policy requires a User-Agent w/ contact email.
// Prefer the user's SEC_USER_AGENT env. Fall back to a generic dev string w/ a loud warning
// so production deployments are forced to set an explicit contact.
const SEC_UA = (() => {
  const env = process.env.SEC_USER_AGENT?.trim();
  if (env) return env;
  process.stderr.write(
    "traderkit: WARNING — SEC_USER_AGENT not set. Using generic dev UA. " +
    "Set SEC_USER_AGENT=\"your-app contact: you@example.com\" for production.\n",
  );
  return "traderkit-mcp-dev (set SEC_USER_AGENT env for production)";
})();

// SEC fair-use: individual response size cap to prevent memory blow-ups on very large 13F XML.
const SEC_MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB

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
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > SEC_MAX_RESPONSE_BYTES) {
    throw new Error(`SEC response too large (${len} bytes > ${SEC_MAX_RESPONSE_BYTES} cap) for ${url.split("/").slice(-2).join("/")}`);
  }
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

export interface SecActivistFiling {
  form: string;
  filing_date: string;
  accession: string;
  filer_names: string[];
  filer_ciks: string[];
  subject_names: string[];
  subject_tickers: string[];
  subject_ciks: string[];
  doc_url: string;
}

interface ParsedName { name: string; tickers: string[]; cik?: string | undefined }

function parseDisplayNames(raw: string[] | undefined): ParsedName[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedName[] = [];
  for (const s of raw) {
    const tickerMatch = s.match(/\(([^)]+)\)\s+\(CIK/i);
    const cikMatch = s.match(/CIK\s+(\d{10})/i);
    const nameMatch = s.match(/^(.+?)\s+\(/);
    const tickers = tickerMatch ? tickerMatch[1]!.split(",").map((t) => t.trim()).filter((t) => /^[A-Z\-.]{1,10}$/.test(t)) : [];
    const entry: ParsedName = {
      name: (nameMatch?.[1] ?? s).trim(),
      tickers,
    };
    if (cikMatch?.[1]) entry.cik = cikMatch[1];
    out.push(entry);
  }
  return out;
}

export interface SecFilingSearchOpts {
  query?: string;
  forms: string[];
  start_date: string;
  end_date: string;
  limit?: number;
}

export async function secSearchFilings(opts: SecFilingSearchOpts): Promise<SecActivistFiling[]> {
  const params = new URLSearchParams({
    q: opts.query ?? `"${opts.forms[0]!}"`,
    forms: opts.forms.join(","),
    dateRange: "custom",
    startdt: opts.start_date,
    enddt: opts.end_date,
  });
  const url = `https://efts.sec.gov/LATEST/search-index?${params}`;
  try {
    const res = await secGet(url);
    const data = (await res.json()) as {
      hits?: {
        hits?: Array<{
          _id?: string;
          _source?: {
            form?: string;
            file_date?: string;
            display_names?: string[];
            ciks?: string[];
            tickers?: string[];
            adsh?: string;
          };
        }>;
      };
    };
    const hits = data.hits?.hits ?? [];
    const limit = opts.limit ?? 50;
    const out: SecActivistFiling[] = [];
    for (const h of hits.slice(0, limit)) {
      const src = h._source ?? {};
      const id = h._id ?? "";
      const [accDocPart, docName] = id.split(":");
      const accession = src.adsh ?? accDocPart ?? "";
      const accessionNoDashes = accession.replace(/-/g, "");
      const allNames = parseDisplayNames(src.display_names);
      // EDGAR display_names: first entry is subject, subsequent are filers (heuristic).
      // But often it's reversed. Use presence of ticker to classify: subject typically has ticker.
      const withTickers = allNames.filter((n) => n.tickers.length > 0);
      const withoutTickers = allNames.filter((n) => n.tickers.length === 0);
      const subject = withTickers[0] ?? allNames[0];
      const filers = withoutTickers.length ? withoutTickers : allNames.slice(1);
      const firstCik = (src.ciks ?? [])[0] ?? "";
      const docUrl = firstCik && accessionNoDashes && docName
        ? `https://www.sec.gov/Archives/edgar/data/${firstCik.replace(/^0+/, "")}/${accessionNoDashes}/${docName}`
        : "";
      out.push({
        form: src.form ?? "",
        filing_date: src.file_date ?? "",
        accession,
        filer_names: filers.map((f) => f.name),
        filer_ciks: filers.map((f) => f.cik ?? "").filter(Boolean),
        subject_names: subject ? [subject.name] : [],
        subject_tickers: subject?.tickers ?? [],
        subject_ciks: subject?.cik ? [subject.cik] : [],
        doc_url: docUrl,
      });
    }
    return out;
  } catch (e) {
    process.stderr.write(`traderkit: secSearchFilings failed: ${toMessage(e)}\n`);
    return [];
  }
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
