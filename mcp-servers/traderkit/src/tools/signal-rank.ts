import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";
import { round } from "../utils/math.js";

const SignalInput = z.object({
  ticker: TickerSchema,
  source: z.string().min(1),
  direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
  confidence: z.number().min(0).max(1),
  detail: z.string().optional(),
});

export const SignalRankArgs = z.object({
  signals: z.array(SignalInput),
  multi_source_bonus: z.number().min(0).max(0.5).default(0.1),
  min_confidence: z.number().min(0).max(1).default(0.3),
  max_results: z.number().positive().default(20),
});

interface RankedSignal {
  ticker: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  composite_confidence: number;
  source_count: number;
  sources: string[];
  top_detail: string | null;
  raw_signals: Array<{ source: string; confidence: number; direction: string }>;
}

export async function signalRankHandler(raw: unknown) {
  const args = SignalRankArgs.parse(raw);

  const byTicker = new Map<string, typeof args.signals>();
  for (const s of args.signals) {
    if (!byTicker.has(s.ticker)) byTicker.set(s.ticker, []);
    byTicker.get(s.ticker)!.push(s);
  }

  const ranked: RankedSignal[] = [];
  for (const [ticker, signals] of byTicker) {
    const deduped = dedupBySource(signals);
    const sourceCount = deduped.length;
    const baseConfidence = Math.max(...deduped.map((s) => s.confidence));
    const bonus = (sourceCount - 1) * args.multi_source_bonus;
    const composite = Math.min(1.0, round(baseConfidence + bonus));

    if (composite < args.min_confidence) continue;

    const directionVotes = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
    for (const s of deduped) directionVotes[s.direction] += s.confidence;
    const direction = (Object.entries(directionVotes) as Array<[keyof typeof directionVotes, number]>)
      .sort((a, b) => b[1] - a[1])[0]![0];

    const topDetail = deduped
      .filter((s) => s.detail)
      .sort((a, b) => b.confidence - a.confidence)[0]?.detail ?? null;

    ranked.push({
      ticker,
      direction,
      composite_confidence: composite,
      source_count: sourceCount,
      sources: deduped.map((s) => s.source),
      top_detail: topDetail,
      raw_signals: deduped.map((s) => ({
        source: s.source,
        confidence: s.confidence,
        direction: s.direction,
      })),
    });
  }

  ranked.sort((a, b) => b.composite_confidence - a.composite_confidence);
  const results = ranked.slice(0, args.max_results);

  return {
    ranked: results,
    total_signals: args.signals.length,
    unique_tickers: byTicker.size,
    returned: results.length,
    filtered_below_min: byTicker.size - ranked.length,
  };
}

function dedupBySource(signals: z.infer<typeof SignalInput>[]): z.infer<typeof SignalInput>[] {
  const seen = new Map<string, z.infer<typeof SignalInput>>();
  for (const s of signals) {
    const existing = seen.get(s.source);
    if (!existing || s.confidence > existing.confidence) {
      seen.set(s.source, s);
    }
  }
  return [...seen.values()];
}
