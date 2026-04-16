import { describe, expect, it } from "vitest";
import { signalRankHandler } from "../../src/tools/signal-rank.js";

describe("signalRankHandler", () => {
  it("ranks by composite confidence descending", async () => {
    const r = await signalRankHandler({
      signals: [
        { ticker: "AAPL", source: "darkpool", direction: "BULLISH", confidence: 0.6 },
        { ticker: "NVDA", source: "darkpool", direction: "BULLISH", confidence: 0.9 },
      ],
    });

    expect(r.ranked[0]!.ticker).toBe("NVDA");
    expect(r.ranked[1]!.ticker).toBe("AAPL");
  });

  it("boosts confidence on multi-source confirmation", async () => {
    const r = await signalRankHandler({
      signals: [
        { ticker: "AG", source: "darkpool", direction: "BULLISH", confidence: 0.7 },
        { ticker: "AG", source: "flow", direction: "BULLISH", confidence: 0.6 },
        { ticker: "AG", source: "oi_change", direction: "BULLISH", confidence: 0.5 },
      ],
      multi_source_bonus: 0.1,
    });

    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0]!.ticker).toBe("AG");
    expect(r.ranked[0]!.composite_confidence).toBe(0.9);
    expect(r.ranked[0]!.source_count).toBe(3);
  });

  it("deduplicates by source (keeps highest confidence)", async () => {
    const r = await signalRankHandler({
      signals: [
        { ticker: "SPY", source: "darkpool", direction: "BEARISH", confidence: 0.4 },
        { ticker: "SPY", source: "darkpool", direction: "BEARISH", confidence: 0.8 },
      ],
    });

    expect(r.ranked[0]!.source_count).toBe(1);
    expect(r.ranked[0]!.composite_confidence).toBe(0.8);
  });

  it("filters below min_confidence", async () => {
    const r = await signalRankHandler({
      signals: [
        { ticker: "AAPL", source: "darkpool", direction: "BULLISH", confidence: 0.2 },
        { ticker: "NVDA", source: "darkpool", direction: "BULLISH", confidence: 0.5 },
      ],
      min_confidence: 0.3,
    });

    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0]!.ticker).toBe("NVDA");
    expect(r.filtered_below_min).toBe(1);
  });

  it("resolves direction by confidence-weighted votes", async () => {
    const r = await signalRankHandler({
      signals: [
        { ticker: "TSLA", source: "darkpool", direction: "BULLISH", confidence: 0.9 },
        { ticker: "TSLA", source: "flow", direction: "BEARISH", confidence: 0.3 },
      ],
    });

    expect(r.ranked[0]!.direction).toBe("BULLISH");
  });

  it("caps composite at 1.0", async () => {
    const r = await signalRankHandler({
      signals: [
        { ticker: "X", source: "a", direction: "BULLISH", confidence: 0.9 },
        { ticker: "X", source: "b", direction: "BULLISH", confidence: 0.8 },
        { ticker: "X", source: "c", direction: "BULLISH", confidence: 0.7 },
        { ticker: "X", source: "d", direction: "BULLISH", confidence: 0.6 },
      ],
      multi_source_bonus: 0.1,
    });

    expect(r.ranked[0]!.composite_confidence).toBe(1.0);
  });

  it("respects max_results", async () => {
    const signals = Array.from({ length: 30 }, (_, i) => ({
      ticker: `T${i}`, source: "flow", direction: "BULLISH" as const, confidence: 0.5,
    }));
    const r = await signalRankHandler({ signals, max_results: 5 });

    expect(r.returned).toBe(5);
    expect(r.unique_tickers).toBe(30);
  });

  it("includes top_detail from highest-confidence signal", async () => {
    const r = await signalRankHandler({
      signals: [
        { ticker: "AG", source: "darkpool", direction: "BULLISH", confidence: 0.9, detail: "large block" },
        { ticker: "AG", source: "flow", direction: "BULLISH", confidence: 0.5, detail: "small sweep" },
      ],
    });

    expect(r.ranked[0]!.top_detail).toBe("large block");
  });

  it("handles empty signals", async () => {
    const r = await signalRankHandler({ signals: [] });
    expect(r.ranked).toHaveLength(0);
    expect(r.total_signals).toBe(0);
  });
});
