const FINNHUB_BASE = "https://finnhub.io/api/v1";

export interface FinnhubProfile {
  ticker: string;
  name?: string | undefined;
  market_cap_usd?: number | undefined;
  sector?: string | undefined;
  industry?: string | undefined;
  country?: string | undefined;
  exchange?: string | undefined;
  ipo_date?: string | undefined;
}

export interface FinnhubEarnings {
  ticker: string;
  next_earnings_date?: string | undefined;
  previous_earnings_date?: string | undefined;
  timing?: "bmo" | "amc" | "unknown" | undefined;
}

async function fhGet(path: string, params: Record<string, string>): Promise<any> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY not set");
  const qs = new URLSearchParams({ ...params, token });
  const res = await fetch(`${FINNHUB_BASE}${path}?${qs}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Finnhub ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function finnhubProfile(ticker: string): Promise<FinnhubProfile> {
  try {
    const j = await fhGet("/stock/profile2", { symbol: ticker.toUpperCase() });
    return {
      ticker: ticker.toUpperCase(),
      name: j.name,
      market_cap_usd: j.marketCapitalization != null ? Number(j.marketCapitalization) * 1_000_000 : undefined,
      sector: j.finnhubIndustry,
      industry: j.finnhubIndustry,
      country: j.country,
      exchange: j.exchange,
      ipo_date: j.ipo,
    };
  } catch {
    return { ticker: ticker.toUpperCase() };
  }
}

function parseTiming(raw: any): "bmo" | "amc" | "unknown" {
  const h = String(raw ?? "").toLowerCase();
  if (h === "bmo" || h === "before market open") return "bmo";
  if (h === "amc" || h === "after market close") return "amc";
  return "unknown";
}

export async function finnhubEarnings(ticker: string, fromIso?: string, toIso?: string): Promise<FinnhubEarnings> {
  const today = new Date();
  const from = fromIso ?? new Date(today.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const to = toIso ?? new Date(today.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
  try {
    const j = await fhGet("/calendar/earnings", { from, to, symbol: ticker.toUpperCase() });
    const rows: any[] = Array.isArray(j?.earningsCalendar) ? j.earningsCalendar : [];
    const nowIso = today.toISOString().slice(0, 10);
    const upcoming = rows
      .filter((r) => String(r.date) >= nowIso)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    const past = rows
      .filter((r) => String(r.date) < nowIso)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    return {
      ticker: ticker.toUpperCase(),
      next_earnings_date: upcoming?.date,
      previous_earnings_date: past?.date,
      timing: parseTiming(upcoming?.hour),
    };
  } catch {
    return { ticker: ticker.toUpperCase() };
  }
}
