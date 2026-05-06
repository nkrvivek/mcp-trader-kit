import { describe, expect, it, vi } from "vitest";
import { llmCouncilHandler } from "../../src/tools/llm-council.js";
import type {
  LlmCaller,
  LlmCallOutcome,
  ParallelCallSpec,
  ParallelCallOutcome,
} from "../../src/clients/llm-client.js";

// ─── helpers ──────────────────────────────────────────────────────────────

function envelope(verdict: "BUY" | "HOLD" | "SELL", confidence: "HIGH" | "MED" | "LOW", thesis = "ok") {
  return JSON.stringify({
    thesis,
    supporting_points: ["a", "b"],
    risks: ["c"],
    verdict,
    confidence,
  });
}

function rankingText(order: string[]): string {
  return ["FINAL RANKING:", ...order.map((lbl, i) => `${i + 1}. Response ${lbl}`)].join("\n");
}

function chairJson(verdict: "BUY" | "HOLD" | "SELL" | "DEFER", over: Record<string, unknown> = {}) {
  return JSON.stringify({
    verdict,
    conviction: "MED",
    consensus_met: verdict !== "DEFER",
    agreement_score: 0.75,
    pros: ["pro1"],
    cons: ["con1"],
    recommendation: "Proceed with half size",
    sizing_note: "size×0.5",
    disagreement_points: [
      {
        topic: "Earnings risk",
        bull_view: "post-earnings volatility low",
        bear_view: "guidance uncertain",
        models_split: { bull: ["claude-opus-4-7"], bear: ["gpt-5.1"] },
      },
    ],
    model_rankings: {
      "claude-opus-4-7": 1,
      "claude-sonnet-4-6": 2,
      "gpt-5.1": 3,
      "gpt-4o": 4,
    },
    ...over,
  });
}

interface ScriptedResponse {
  text?: string;
  error?: string;
}

function makeLlm(scripts: {
  stage1?: ScriptedResponse[];
  stage2?: ScriptedResponse[];
  chair?: ScriptedResponse;
}): LlmCaller {
  let stage1Idx = 0;
  let stage2Idx = 0;
  let phase: "stage1" | "stage2" | "chair" = "stage1";

  function take(s: ScriptedResponse, model: string): LlmCallOutcome {
    if (s.error) return { ok: false, model, provider: "anthropic", error: s.error };
    return { ok: true, model, provider: "anthropic", text: s.text ?? "{}" };
  }

  return {
    callModelsParallel: vi.fn(async (specs: ParallelCallSpec[]): Promise<ParallelCallOutcome[]> => {
      const target = phase === "stage1" ? scripts.stage1 ?? [] : scripts.stage2 ?? [];
      const out = specs.map((spec, i) => {
        const offset = phase === "stage1" ? stage1Idx + i : stage2Idx + i;
        const s = target[offset] ?? { text: "{}" };
        return { ...take(s, spec.model), seat: spec.seat };
      });
      if (phase === "stage1") {
        stage1Idx += specs.length;
        phase = "stage2";
      } else {
        stage2Idx += specs.length;
        phase = "chair";
      }
      return out;
    }),
    callModel: vi.fn(async (model: string): Promise<LlmCallOutcome> => {
      return take(scripts.chair ?? { text: "{}" }, model);
    }),
  };
}

const baseInput = () => ({
  candidate: {
    ticker: "AAPL",
    structure: "covered_call",
    direction: "STO",
    qty: 5,
    notional_usd: 5000,
    signal_rank: 55,
    thesis_ref: "aapl-cc-ladder",
  },
  regime_tier: "caution" as const,
  council_seats: [
    { model: "claude-opus-4-7", provider: "anthropic" as const, stance: "neutral" as const },
    { model: "claude-sonnet-4-6", provider: "anthropic" as const, stance: "neutral" as const },
    { model: "gpt-5.1", provider: "openai" as const, stance: "neutral" as const },
    { model: "gpt-4o", provider: "openai" as const, stance: "neutral" as const },
    { model: "claude-sonnet-4-6", provider: "anthropic" as const, stance: "skeptic" as const },
  ],
  chairman_model: "claude-opus-4-7",
});

// ─── tests ────────────────────────────────────────────────────────────────

describe("llmCouncilHandler", () => {
  it("happy path: 5 seats opine, chair synthesizes BUY w/ disagreements", async () => {
    const llm = makeLlm({
      stage1: [
        { text: envelope("BUY", "HIGH") },
        { text: envelope("BUY", "MED") },
        { text: envelope("BUY", "MED") },
        { text: envelope("HOLD", "MED") },
        { text: envelope("HOLD", "LOW", "skeptic concern") },
      ],
      stage2: Array(5).fill({ text: rankingText(["A", "B", "C", "D", "E"]) }),
      chair: { text: chairJson("BUY") },
    });

    const r = (await llmCouncilHandler(baseInput(), { llm })) as Record<string, unknown>;
    expect(r.ticker).toBe("AAPL");
    expect(r.verdict).toBe("BUY");
    expect(r.conviction).toBe("MED");
    expect(r.stage1_voices).toBe(5);
    expect(r.consensus_observed).toBe(true);
    expect(r.stage1_verdict_tally).toEqual({ BUY: 3, HOLD: 2, SELL: 0 });
    expect(Array.isArray(r.disagreement_points)).toBe(true);
    expect((r.disagreement_points as unknown[]).length).toBeGreaterThan(0);
  });

  it("eligibility gate: skips under HALT regime", async () => {
    const llm = makeLlm({});
    const input = { ...baseInput(), regime_tier: "halt" as const };
    const r = (await llmCouncilHandler(input, { llm })) as Record<string, unknown>;
    expect(r.skipped).toBe(true);
    expect(r.skip_reason).toBe("regime_halt");
    expect(llm.callModel).not.toHaveBeenCalled();
    expect(llm.callModelsParallel).not.toHaveBeenCalled();
  });

  it("eligibility gate: skips rolls", async () => {
    const llm = makeLlm({});
    const input = baseInput();
    input.candidate.structure = "roll_short_call";
    const r = (await llmCouncilHandler(input, { llm })) as Record<string, unknown>;
    expect(r.skipped).toBe(true);
    expect(r.skip_reason).toBe("skip_rolls");
  });

  it("eligibility gate: skips below TIER-1 (signal_rank < 40)", async () => {
    const llm = makeLlm({});
    const input = baseInput();
    input.candidate.signal_rank = 25;
    const r = (await llmCouncilHandler(input, { llm })) as Record<string, unknown>;
    expect(r.skipped).toBe(true);
    expect(r.skip_reason).toBe("below_tier1");
  });

  it("partial Stage 1 failure: dropped seats don't kill council (Karpathy pattern)", async () => {
    const llm = makeLlm({
      stage1: [
        { text: envelope("BUY", "HIGH") },
        { error: "anthropic 529: overloaded" },
        { text: envelope("BUY", "MED") },
        { text: envelope("HOLD", "MED") },
        { text: envelope("HOLD", "LOW") },
      ],
      stage2: Array(4).fill({ text: rankingText(["A", "B", "C", "D"]) }),
      chair: { text: chairJson("BUY") },
    });

    const r = (await llmCouncilHandler(baseInput(), { llm })) as Record<string, unknown>;
    expect(r.stage1_voices).toBe(4);
    expect(r.verdict).toBe("BUY");
    const failures = r.stage1_failures as Array<{ seat: string; error: string }>;
    expect(failures.length).toBe(1);
    expect(failures[0]?.error).toMatch(/overloaded/);
  });

  it("all Stage 1 fail: returns skip envelope", async () => {
    const llm = makeLlm({
      stage1: Array(5).fill({ error: "anthropic 500: server error" }),
    });
    const r = (await llmCouncilHandler(baseInput(), { llm })) as Record<string, unknown>;
    expect(r.skipped).toBe(true);
    expect(r.skip_reason).toBe("all_models_failed");
    expect(llm.callModel).not.toHaveBeenCalled();
  });

  it("chair failure: returns Karpathy fallback HOLD verdict", async () => {
    const llm = makeLlm({
      stage1: Array(5).fill({ text: envelope("BUY", "MED") }),
      stage2: Array(5).fill({ text: rankingText(["A", "B", "C", "D", "E"]) }),
      chair: { error: "openai 503: chair unavailable" },
    });
    const r = (await llmCouncilHandler(baseInput(), { llm })) as Record<string, unknown>;
    expect(r.chair_failed).toBe(true);
    expect(r.verdict).toBe("HOLD");
    expect(r.recommendation).toMatch(/Council chair unavailable/);
  });

  it("chair returns malformed JSON: returns parse-error fallback", async () => {
    const llm = makeLlm({
      stage1: Array(5).fill({ text: envelope("BUY", "MED") }),
      stage2: Array(5).fill({ text: rankingText(["A", "B", "C", "D", "E"]) }),
      chair: { text: "this is not json at all" },
    });
    const r = (await llmCouncilHandler(baseInput(), { llm })) as Record<string, unknown>;
    expect(r.verdict).toBe("HOLD");
    expect(r.chair_parse_error).toBeDefined();
  });

  it("chair DEFER: when consensus threshold not met", async () => {
    const llm = makeLlm({
      stage1: [
        { text: envelope("BUY", "HIGH") },
        { text: envelope("HOLD", "MED") },
        { text: envelope("SELL", "MED") },
        { text: envelope("HOLD", "LOW") },
        { text: envelope("SELL", "MED") },
      ],
      stage2: Array(5).fill({ text: rankingText(["A", "B", "C", "D", "E"]) }),
      chair: { text: chairJson("DEFER") },
    });
    const r = (await llmCouncilHandler(baseInput(), { llm })) as Record<string, unknown>;
    expect(r.verdict).toBe("DEFER");
    // consensus_observed: max tally is 2 (HOLD+SELL tied), threshold 3 not met
    expect(r.consensus_observed).toBe(false);
  });

  it("Stage 1 envelope w/ fenced JSON code block: still parses", async () => {
    const fenced = "```json\n" + envelope("BUY", "HIGH") + "\n```";
    const llm = makeLlm({
      stage1: [
        { text: fenced },
        { text: envelope("BUY", "MED") },
        { text: envelope("BUY", "MED") },
        { text: envelope("HOLD", "MED") },
        { text: envelope("HOLD", "LOW") },
      ],
      stage2: Array(5).fill({ text: rankingText(["A", "B", "C", "D", "E"]) }),
      chair: { text: chairJson("BUY") },
    });
    const r = (await llmCouncilHandler(baseInput(), { llm })) as Record<string, unknown>;
    expect((r.stage1_verdict_tally as Record<string, number>).BUY).toBe(3);
  });

  it("malformed Stage 2 ranking: silently dropped (chair still gets some rankings)", async () => {
    const llm = makeLlm({
      stage1: Array(5).fill({ text: envelope("BUY", "MED") }),
      stage2: [
        { text: rankingText(["A", "B", "C", "D", "E"]) },
        { text: "no ranking format here" },
        { text: rankingText(["B", "A", "C", "D", "E"]) },
        { text: rankingText(["C", "A", "B", "D", "E"]) },
        { text: rankingText(["D", "C", "B", "A", "E"]) },
      ],
      chair: { text: chairJson("BUY") },
    });
    const r = (await llmCouncilHandler(baseInput(), { llm })) as Record<string, unknown>;
    expect(r.verdict).toBe("BUY");
  });

  it("skeptic seat receives contrarian system prompt", async () => {
    const captured: Array<{ system: string; user: string }> = [];
    const llm: LlmCaller = {
      callModelsParallel: vi.fn(async (specs: ParallelCallSpec[]): Promise<ParallelCallOutcome[]> => {
        for (const s of specs) {
          captured.push({
            system: s.messages.find((m) => m.role === "system")?.content ?? "",
            user: s.messages.find((m) => m.role === "user")?.content ?? "",
          });
        }
        return specs.map((s) => ({
          ok: true as const,
          model: s.model,
          provider: "anthropic" as const,
          text: envelope("BUY", "MED"),
          seat: s.seat,
        }));
      }),
      callModel: vi.fn(async (model: string): Promise<LlmCallOutcome> => ({
        ok: true,
        model,
        provider: "anthropic",
        text: chairJson("BUY"),
      })),
    };
    await llmCouncilHandler(baseInput(), { llm });
    // First batch is stage 1: last seat is skeptic
    const skepticPrompt = captured[4]?.system ?? "";
    expect(skepticPrompt).toMatch(/Skeptic/);
    expect(skepticPrompt).toMatch(/bearish/i);
    // Neutral seats should NOT have skeptic overlay
    expect(captured[0]?.system).not.toMatch(/Skeptic/);
  });

  it("respects min_signal_rank override", async () => {
    const llm = makeLlm({});
    const input = { ...baseInput(), min_signal_rank: 70 };
    input.candidate.signal_rank = 50; // above default 40, below override 70
    const r = (await llmCouncilHandler(input, { llm })) as Record<string, unknown>;
    expect(r.skipped).toBe(true);
    expect(r.skip_reason).toBe("below_tier1");
  });

  it("missing signal_rank does NOT trigger skip (only explicit low values)", async () => {
    const llm = makeLlm({
      stage1: Array(5).fill({ text: envelope("BUY", "MED") }),
      stage2: Array(5).fill({ text: rankingText(["A", "B", "C", "D", "E"]) }),
      chair: { text: chairJson("BUY") },
    });
    const input = baseInput();
    delete (input.candidate as { signal_rank?: number }).signal_rank;
    const r = (await llmCouncilHandler(input, { llm })) as Record<string, unknown>;
    expect(r.skipped).toBeUndefined();
    expect(r.verdict).toBe("BUY");
  });
});
