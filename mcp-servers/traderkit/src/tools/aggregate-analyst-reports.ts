import { z } from "zod";

export const AggregateAnalystReportsArgs = z.object({
  ticker: z.string().min(1),
  fundamentals_md: z.string().optional().default(""),
  market_md: z.string().optional().default(""),
  news_md: z.string().optional().default(""),
  sentiment_md: z.string().optional().default(""),
});

interface ReportSignal {
  source: "fundamentals" | "market" | "news" | "sentiment";
  bias: "+" | "-" | "0" | "?";
  magnitude: "L" | "M" | "H";
  confidence: number;
  notes: string[];
}

const BIAS_RE = /\b(bias|net[_\s-]*bias|direction)\s*[:=]?\s*([+\-−–]+|positive|negative|neutral|bullish|bearish|long|short)\b/i;
const MAG_RE = /\b(magnitude)\s*[:=]?\s*(L|M|H|low|medium|high)\b/i;
const CONF_RE = /\b(confidence|conf)\s*[:=]?\s*(0?\.\d+|\d+%|\d+\/\d+)\b/i;

const POS_KEYWORDS = ["bullish", "buy", "accumulation", "positive", "outperform", "growth", "beat", "upgrade", "constructive"];
const NEG_KEYWORDS = ["bearish", "sell", "distribution", "negative", "underperform", "miss", "downgrade", "warning", "death cross", "headwind"];

function parseConfidence(raw: string): number {
  if (!raw) return 0.5;
  if (raw.endsWith("%")) return Math.min(1, Math.max(0, parseInt(raw, 10) / 100));
  if (raw.includes("/")) {
    const parts = raw.split("/").map((n) => parseFloat(n));
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (b > 0) return Math.min(1, Math.max(0, a / b));
  }
  const f = parseFloat(raw);
  if (!Number.isNaN(f)) return Math.min(1, Math.max(0, f));
  return 0.5;
}

function classifyBias(text: string): "+" | "-" | "0" | "?" {
  if (!text.trim()) return "?";
  const m = text.match(BIAS_RE);
  if (m && m[2]) {
    const v = m[2].toLowerCase();
    if (/^[+]+$|positive|bullish|long/.test(v)) return "+";
    if (/^[-−–]+$|negative|bearish|short/.test(v)) return "-";
    if (/neutral/.test(v)) return "0";
  }
  const lower = text.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const k of POS_KEYWORDS) if (lower.includes(k)) pos++;
  for (const k of NEG_KEYWORDS) if (lower.includes(k)) neg++;
  if (pos === 0 && neg === 0) return "?";
  if (pos > neg * 1.5) return "+";
  if (neg > pos * 1.5) return "-";
  return "0";
}

function classifyMagnitude(text: string): "L" | "M" | "H" {
  const m = text.match(MAG_RE);
  if (m && m[2]) {
    const v = m[2].toLowerCase();
    if (v.startsWith("h")) return "H";
    if (v.startsWith("l")) return "L";
    return "M";
  }
  // Heuristic by report length and intensifiers
  const intensifiers = (text.match(/\b(strong|massive|extreme|surge|crash|collapse|breakout)\b/gi) ?? []).length;
  if (intensifiers >= 3) return "H";
  if (intensifiers === 0) return "L";
  return "M";
}

function classifyConfidence(text: string): number {
  const m = text.match(CONF_RE);
  if (m && m[2]) return parseConfidence(m[2]);
  // length heuristic — denser report = higher base confidence
  const len = text.length;
  if (len < 100) return 0.3;
  if (len < 500) return 0.5;
  if (len < 2000) return 0.65;
  return 0.75;
}

function extractCatalysts(news: string, fundamentals: string): string[] {
  const out: string[] = [];
  const re = /(?:catalyst|earnings|fed|fomc|cpi|jobs|guidance|launch|approval|partnership|merger|acquisition|dividend|buyback|split|upgrade|downgrade)[^.\n]{0,120}/gi;
  for (const m of (news + "\n" + fundamentals).matchAll(re)) {
    out.push(m[0].trim().replace(/\s+/g, " ").slice(0, 140));
    if (out.length >= 5) break;
  }
  return out;
}

function extractRisks(bear_text: string, sentiment: string): string[] {
  const out: string[] = [];
  const re = /(?:risk|warning|concern|threat|headwind|debt|leverage|dilut|short interest|insider sell|wash[\s-]*sale|concentration|earnings IV|RED tier|R\d+ violation)[^.\n]{0,120}/gi;
  for (const m of (bear_text + "\n" + sentiment).matchAll(re)) {
    out.push(m[0].trim().replace(/\s+/g, " ").slice(0, 140));
    if (out.length >= 5) break;
  }
  return out;
}

export async function aggregateAnalystReportsHandler(raw: unknown) {
  const args = AggregateAnalystReportsArgs.parse(raw);

  const reports: { source: ReportSignal["source"]; text: string }[] = [
    { source: "fundamentals", text: args.fundamentals_md },
    { source: "market", text: args.market_md },
    { source: "news", text: args.news_md },
    { source: "sentiment", text: args.sentiment_md },
  ];

  const signals: ReportSignal[] = reports.map(({ source, text }) => ({
    source,
    bias: classifyBias(text),
    magnitude: classifyMagnitude(text),
    confidence: text.trim() ? classifyConfidence(text) : 0,
    notes: text.trim() ? [] : ["empty report"],
  }));

  // Confluence score: weighted bias alignment × confidence × magnitude
  const MAG_W = { L: 0.5, M: 1.0, H: 1.5 } as const;
  const BIAS_NUM = { "+": 1, "-": -1, "0": 0, "?": 0 } as const;
  let weightedSum = 0;
  let weightDenom = 0;
  for (const s of signals) {
    const w = s.confidence * MAG_W[s.magnitude];
    weightedSum += BIAS_NUM[s.bias] * w;
    weightDenom += w;
  }
  // Net bias score in [-1, 1]
  const net = weightDenom > 0 ? weightedSum / weightDenom : 0;
  // Map to 0-100 signal_score where +1 → 100, -1 → 0, 0 → 50
  const signal_score = Math.round(((net + 1) / 2) * 100);

  // Conflict detection: pairs of sources w/ opposing biases above threshold
  const conflict_points: string[] = [];
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const a = signals[i]!;
      const b = signals[j]!;
      if ((a.bias === "+" && b.bias === "-") || (a.bias === "-" && b.bias === "+")) {
        conflict_points.push(`${a.source}=${a.bias} vs ${b.source}=${b.bias}`);
      }
    }
  }

  const non_empty = signals.filter((s) => s.confidence > 0).length;
  const aligned = signals.filter((s) => s.bias !== "?" && s.bias !== "0" && Math.sign(BIAS_NUM[s.bias]) === Math.sign(net) && net !== 0).length;
  const confluence_summary =
    non_empty < 2
      ? `INSUFFICIENT_DATA (${non_empty}/4 reports w/ usable bias)`
      : conflict_points.length > 0
        ? `MIXED — ${conflict_points.length} conflict(s); ${aligned}/${non_empty} aligned w/ net=${net.toFixed(2)}`
        : aligned >= 3
          ? `STRONG_CONFLUENCE — ${aligned}/${non_empty} aligned, net=${net.toFixed(2)}`
          : `WEAK — ${aligned}/${non_empty} aligned, net=${net.toFixed(2)}`;

  const top_catalysts = extractCatalysts(args.news_md, args.fundamentals_md);
  const top_risks = extractRisks(args.sentiment_md, args.fundamentals_md);

  return {
    ticker: args.ticker,
    signal_score,
    net_bias: Math.round(net * 100) / 100,
    confluence_summary,
    conflict_points,
    top_catalysts,
    top_risks,
    per_source: signals,
    reports_present: non_empty,
  };
}
