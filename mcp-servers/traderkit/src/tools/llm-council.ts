// LLM Trading Council — 3-stage model-diverse debate.
//
// Stage 1: parallel collect — each seat opines on candidate w/ structured envelope
// Stage 2: anonymized cross-rank — each seat ranks all responses by analytical quality
// Stage 3: chair synthesis — chairman emits final structured JSON verdict
//
// Pattern: ported from karpathy/llm-council (3-stage flow + anonymized ranking)
// Extensions: structured envelopes + DisagreementPoint[] + Skeptic seat + consensus gate
//   (borrowed from Manavarya09/Tensor-Trade).
//
// Determinism: this is the only LLM-call tool in traderkit. All other "debate"
// tools (synthesize_debate, risk_debate_3stance) are deterministic regex-scoring.

import { z } from "zod";
import {
  liveLlmCaller,
  type LlmCaller,
  type LlmMessage,
  type ParallelCallSpec,
  type ParallelCallOutcome,
  type Provider,
} from "../clients/llm-client.js";

// ─── input ────────────────────────────────────────────────────────────────

const SeatSchema = z.object({
  model: z.string().min(1),
  provider: z.enum(["anthropic", "openai", "google"]).optional(),
  stance: z.enum(["neutral", "skeptic"]).default("neutral"),
});

const CandidateSchema = z.object({
  ticker: z.string().min(1),
  structure: z.string().min(1),
  direction: z.string().optional(),
  qty: z.number().optional(),
  notional_usd: z.number().optional(),
  signal_rank: z.number().optional(),
  is_roll: z.boolean().optional(),
  thesis_ref: z.string().optional(),
  rationale: z.string().optional(),
}).passthrough();

export const LlmCouncilArgs = z.object({
  candidate: CandidateSchema,
  portfolio_context: z.string().optional().default(""),
  regime_tier: z.enum(["clear", "caution", "defensive", "halt"]).default("caution"),
  thesis_text: z.string().optional().default(""),
  analyst_reports: z.string().optional().default(""),
  economic_calendar: z.string().optional().default(""),
  council_seats: z.array(SeatSchema).default([
    { model: "claude-opus-4-7", provider: "anthropic", stance: "neutral" },
    { model: "claude-sonnet-4-6", provider: "anthropic", stance: "neutral" },
    { model: "gpt-5.1", provider: "openai", stance: "neutral" },
    { model: "gpt-4o", provider: "openai", stance: "neutral" },
    { model: "gemini-3-pro-preview", provider: "google", stance: "neutral" },
    { model: "claude-sonnet-4-6", provider: "anthropic", stance: "skeptic" },
  ]),
  chairman_model: z.string().default("gemini-3-pro-preview"),
  chairman_provider: z.enum(["anthropic", "openai", "google"]).optional(),
  consensus_threshold: z.number().int().min(1).default(3),
  min_signal_rank: z.number().default(40),
  skip_under_halt: z.boolean().default(true),
  skip_rolls: z.boolean().default(true),
  max_tokens_per_call: z.number().int().min(256).default(1500),
});

export type LlmCouncilInput = z.infer<typeof LlmCouncilArgs>;

// ─── prompts ──────────────────────────────────────────────────────────────

const SKEPTIC_OVERLAY = [
  "You are the Skeptic seat of the trading council.",
  "Your role is to find what could go wrong with this trade.",
  "Bias toward the bearish case unless evidence is overwhelming.",
  "Your verdict default is HOLD or SELL; BUY only if pros decisively outweigh cons.",
].join(" ");

const NEUTRAL_OVERLAY = [
  "You are a seat on a trading council.",
  "Your role is to independently analyze the candidate trade and emit a structured verdict.",
  "Be terse, evidence-based, and willing to disagree with consensus.",
].join(" ");

function stage1SystemPrompt(stance: "neutral" | "skeptic"): string {
  return stance === "skeptic" ? SKEPTIC_OVERLAY : NEUTRAL_OVERLAY;
}

function stage1UserPrompt(input: LlmCouncilInput): string {
  const c = input.candidate;
  const lines: string[] = [];
  lines.push(`# Trading Council — Stage 1 — Candidate Analysis`);
  lines.push(``);
  lines.push(`## Candidate`);
  lines.push(`- ticker: ${c.ticker}`);
  lines.push(`- structure: ${c.structure}`);
  if (c.direction) lines.push(`- direction: ${c.direction}`);
  if (typeof c.qty === "number") lines.push(`- qty: ${c.qty}`);
  if (typeof c.notional_usd === "number") lines.push(`- notional_usd: ${c.notional_usd}`);
  if (typeof c.signal_rank === "number") lines.push(`- signal_rank: ${c.signal_rank}`);
  if (c.thesis_ref) lines.push(`- thesis_ref: ${c.thesis_ref}`);
  if (c.rationale) lines.push(`- rationale: ${c.rationale}`);
  lines.push(``);
  lines.push(`## Regime`);
  lines.push(`- tier: ${input.regime_tier.toUpperCase()}`);
  lines.push(``);
  if (input.portfolio_context) {
    lines.push(`## Portfolio context`);
    lines.push(input.portfolio_context);
    lines.push(``);
  }
  if (input.thesis_text) {
    lines.push(`## Thesis`);
    lines.push(input.thesis_text);
    lines.push(``);
  }
  if (input.analyst_reports) {
    lines.push(`## Aggregated analyst reports`);
    lines.push(input.analyst_reports);
    lines.push(``);
  }
  if (input.economic_calendar) {
    lines.push(`## Economic calendar (14d)`);
    lines.push(input.economic_calendar);
    lines.push(``);
  }
  lines.push(`## Output format (STRICT)`);
  lines.push(`Reply with a single JSON object — no markdown, no commentary outside JSON.`);
  lines.push(`Schema:`);
  lines.push(`{`);
  lines.push(`  "thesis": "1-2 sentence trade thesis",`);
  lines.push(`  "supporting_points": ["..."],`);
  lines.push(`  "risks": ["..."],`);
  lines.push(`  "verdict": "BUY|HOLD|SELL",`);
  lines.push(`  "confidence": "HIGH|MED|LOW"`);
  lines.push(`}`);
  return lines.join("\n");
}

function stage2UserPrompt(stage1Texts: string[]): string {
  const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const lines: string[] = [];
  lines.push(`# Trading Council — Stage 2 — Cross-Ranking`);
  lines.push(``);
  lines.push(`Below are ${stage1Texts.length} anonymized Stage-1 responses to the same trading candidate.`);
  lines.push(`Rank them by analytical quality (rigor of evidence, calibration of confidence, risk identification, clarity of recommendation).`);
  lines.push(`Self-included rankings are allowed — be honest, not modest.`);
  lines.push(``);
  for (let i = 0; i < stage1Texts.length; i++) {
    const lbl = labels[i] ?? String(i);
    lines.push(`## Response ${lbl}`);
    lines.push(stage1Texts[i] ?? "");
    lines.push(``);
  }
  lines.push(`## Output format (STRICT)`);
  lines.push(`Reply with exactly:`);
  lines.push(`FINAL RANKING:`);
  lines.push(`1. Response X`);
  lines.push(`2. Response Y`);
  lines.push(`(continue for all ${stage1Texts.length} responses)`);
  return lines.join("\n");
}

function stage3UserPrompt(
  input: LlmCouncilInput,
  stage1: Array<{ seat: string; model: string; stance: string; text: string }>,
  stage2Rankings: Array<{ seat: string; model: string; ranking: string[] }>,
): string {
  const c = input.candidate;
  const lines: string[] = [];
  lines.push(`# Trading Council — Stage 3 — Chair Synthesis`);
  lines.push(``);
  lines.push(`You are the chair of a trading council. Your job is to synthesize the council's analysis into a final structured verdict.`);
  lines.push(``);
  lines.push(`## Bias correction (IMPORTANT)`);
  lines.push(`The council spans three providers (Anthropic, OpenAI, Google). When seats from your own provider agree among themselves but seats from another provider dissent, weight the cross-provider dissent more heavily — assume your own provider may share blind spots.`);
  lines.push(`The Skeptic seat is a contrarian gut-check, not an equal voice; weight its dissent as a probe, not as a vote.`);
  lines.push(``);
  lines.push(`## Candidate (recap)`);
  lines.push(`${c.ticker} · ${c.structure}` + (c.direction ? ` · ${c.direction}` : ""));
  if (typeof c.signal_rank === "number") lines.push(`signal_rank: ${c.signal_rank}`);
  lines.push(`regime: ${input.regime_tier.toUpperCase()}`);
  lines.push(``);
  lines.push(`## Stage 1 — De-anonymized responses`);
  for (const s of stage1) {
    lines.push(`### ${s.seat} — ${s.model} (${s.stance})`);
    lines.push(s.text);
    lines.push(``);
  }
  lines.push(`## Stage 2 — Cross-rankings (each seat's view)`);
  for (const r of stage2Rankings) {
    lines.push(`### ${r.seat} (${r.model}) ranking: ${r.ranking.join(" > ")}`);
  }
  lines.push(``);
  lines.push(`## Output format (STRICT)`);
  lines.push(`Reply with a single JSON object — no markdown fences, no commentary outside JSON.`);
  lines.push(`Schema:`);
  lines.push(`{`);
  lines.push(`  "verdict": "BUY|HOLD|SELL|DEFER",`);
  lines.push(`  "conviction": "LOW|MED|HIGH",`);
  lines.push(`  "consensus_met": true,`);
  lines.push(`  "agreement_score": 0.0,`);
  lines.push(`  "pros": ["..."],`);
  lines.push(`  "cons": ["..."],`);
  lines.push(`  "recommendation": "single sentence",`);
  lines.push(`  "sizing_note": "e.g. size×0.5",`);
  lines.push(`  "disagreement_points": [`);
  lines.push(`    {"topic": "...", "bull_view": "...", "bear_view": "...", "models_split": {"bull": ["..."], "bear": ["..."]}}`);
  lines.push(`  ],`);
  lines.push(`  "model_rankings": {"<model>": <int rank>, ...}`);
  lines.push(`}`);
  lines.push(`Set verdict=DEFER if fewer than ${input.consensus_threshold} Stage-1 voices align on the same verdict at HIGH/MED confidence.`);
  return lines.join("\n");
}

// ─── parsing helpers ──────────────────────────────────────────────────────

interface Stage1Envelope {
  thesis: string;
  supporting_points: string[];
  risks: string[];
  verdict: "BUY" | "HOLD" | "SELL";
  confidence: "HIGH" | "MED" | "LOW";
}

function extractJson(text: string): unknown {
  // Try fenced code first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text) ?? "";
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function asString(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

function parseStage1(text: string): Stage1Envelope {
  const obj = extractJson(text) as Record<string, unknown>;
  const verdict = asString(obj.verdict, "HOLD").toUpperCase();
  const confidence = asString(obj.confidence, "LOW").toUpperCase();
  return {
    thesis: asString(obj.thesis),
    supporting_points: asStringArray(obj.supporting_points),
    risks: asStringArray(obj.risks),
    verdict: (["BUY", "HOLD", "SELL"].includes(verdict) ? verdict : "HOLD") as "BUY" | "HOLD" | "SELL",
    confidence: (["HIGH", "MED", "LOW"].includes(confidence) ? confidence : "LOW") as "HIGH" | "MED" | "LOW",
  };
}

function parseStage2Ranking(text: string, n: number): string[] {
  const labels = ["A", "B", "C", "D", "E", "F", "G", "H"].slice(0, n);
  // Find lines like "1. Response A" after "FINAL RANKING:"
  const idx = text.toUpperCase().indexOf("FINAL RANKING");
  const tail = idx >= 0 ? text.slice(idx) : text;
  const ranks: string[] = [];
  for (const line of tail.split(/\r?\n/)) {
    const m = line.match(/^\s*\d+\.\s*Response\s+([A-H])\b/i);
    if (m && m[1]) {
      const lbl = m[1].toUpperCase();
      if (labels.includes(lbl) && !ranks.includes(lbl)) ranks.push(lbl);
    }
    if (ranks.length === n) break;
  }
  // Pad missing labels at the end (preserves caller's intent that all seats are ranked).
  for (const lbl of labels) {
    if (!ranks.includes(lbl)) ranks.push(lbl);
  }
  return ranks;
}

interface Stage3Envelope {
  verdict: "BUY" | "HOLD" | "SELL" | "DEFER";
  conviction: "LOW" | "MED" | "HIGH";
  consensus_met: boolean;
  agreement_score: number;
  pros: string[];
  cons: string[];
  recommendation: string;
  sizing_note: string;
  disagreement_points: Array<{
    topic: string;
    bull_view: string;
    bear_view: string;
    models_split: { bull: string[]; bear: string[] };
  }>;
  model_rankings: Record<string, number>;
}

function parseStage3(text: string): Stage3Envelope {
  const obj = extractJson(text) as Record<string, unknown>;
  const verdict = asString(obj.verdict, "HOLD").toUpperCase();
  const conviction = asString(obj.conviction, "LOW").toUpperCase();
  const dpRaw = Array.isArray(obj.disagreement_points) ? (obj.disagreement_points as unknown[]) : [];
  const disagreement_points = dpRaw.map((d) => {
    const r = (d ?? {}) as Record<string, unknown>;
    const split = (r.models_split ?? {}) as Record<string, unknown>;
    return {
      topic: asString(r.topic),
      bull_view: asString(r.bull_view),
      bear_view: asString(r.bear_view),
      models_split: {
        bull: asStringArray(split.bull),
        bear: asStringArray(split.bear),
      },
    };
  });
  const rankRaw = (obj.model_rankings ?? {}) as Record<string, unknown>;
  const model_rankings: Record<string, number> = {};
  for (const [k, v] of Object.entries(rankRaw)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) model_rankings[k] = Math.round(n);
  }
  const score = Number(obj.agreement_score);
  return {
    verdict: (["BUY", "HOLD", "SELL", "DEFER"].includes(verdict) ? verdict : "DEFER") as Stage3Envelope["verdict"],
    conviction: (["LOW", "MED", "HIGH"].includes(conviction) ? conviction : "LOW") as Stage3Envelope["conviction"],
    consensus_met: Boolean(obj.consensus_met),
    agreement_score: Number.isFinite(score) ? score : 0,
    pros: asStringArray(obj.pros),
    cons: asStringArray(obj.cons),
    recommendation: asString(obj.recommendation),
    sizing_note: asString(obj.sizing_note),
    disagreement_points,
    model_rankings,
  };
}

// ─── eligibility ──────────────────────────────────────────────────────────

interface EligibilityResult {
  ok: boolean;
  reason?: string;
}

function isEligible(input: LlmCouncilInput): EligibilityResult {
  if (input.skip_under_halt && input.regime_tier === "halt") return { ok: false, reason: "regime_halt" };
  const struct = (input.candidate.structure ?? "").toLowerCase();
  if (input.skip_rolls && (input.candidate.is_roll || struct.includes("roll"))) return { ok: false, reason: "skip_rolls" };
  if (typeof input.candidate.signal_rank === "number" && input.candidate.signal_rank < input.min_signal_rank) {
    return { ok: false, reason: "below_tier1" };
  }
  return { ok: true };
}

// ─── handler ──────────────────────────────────────────────────────────────

export async function llmCouncilHandler(raw: unknown, deps?: { llm?: LlmCaller }): Promise<unknown> {
  const input = LlmCouncilArgs.parse(raw);
  const llm = deps?.llm ?? liveLlmCaller;

  // Stage 0 — eligibility
  const elig = isEligible(input);
  if (!elig.ok) {
    return {
      ticker: input.candidate.ticker,
      skipped: true,
      skip_reason: elig.reason,
    };
  }

  // Stage 1 — parallel collect
  const seatLabels = input.council_seats.map((_, i) => `seat_${i + 1}`);
  const stage1Specs: ParallelCallSpec[] = input.council_seats.map((seat, i): ParallelCallSpec => {
    const messages: LlmMessage[] = [
      { role: "system", content: stage1SystemPrompt(seat.stance) },
      { role: "user", content: stage1UserPrompt(input) },
    ];
    const spec: ParallelCallSpec = {
      model: seat.model,
      messages,
      opts: { max_tokens: input.max_tokens_per_call },
    };
    const seatLabel = seatLabels[i];
    if (seatLabel) spec.seat = seatLabel;
    if (seat.provider) spec.provider = seat.provider;
    return spec;
  });

  const stage1Outcomes = await llm.callModelsParallel(stage1Specs);

  const stage1: Array<{
    seat: string;
    model: string;
    provider: Provider;
    stance: string;
    text: string;
    parsed?: Stage1Envelope;
  }> = [];
  const failures: Array<{ seat: string; model: string; error: string }> = [];

  stage1Outcomes.forEach((outcome, i) => {
    const seatCfg = input.council_seats[i];
    if (!seatCfg) return;
    const seat = seatLabels[i] ?? `seat_${i + 1}`;
    if (outcome.ok === false) {
      failures.push({ seat, model: outcome.model, error: outcome.error });
      return;
    }
    let parsed: Stage1Envelope | undefined;
    try {
      parsed = parseStage1(outcome.text);
    } catch {
      // Keep raw text but no parsed envelope — still usable in Stage 2/3.
    }
    stage1.push({
      seat,
      model: outcome.model,
      provider: outcome.provider,
      stance: seatCfg.stance,
      text: outcome.text,
      ...(parsed ? { parsed } : {}),
    });
  });

  if (stage1.length === 0) {
    return {
      ticker: input.candidate.ticker,
      skipped: true,
      skip_reason: "all_models_failed",
      failures,
    };
  }

  // Stage 2 — anonymized cross-rank
  const labels = ["A", "B", "C", "D", "E", "F", "G", "H"].slice(0, stage1.length);
  const anonymizedTexts = stage1.map((s) => s.text);

  const stage2Specs: ParallelCallSpec[] = stage1.map((s): ParallelCallSpec => {
    const messages: LlmMessage[] = [
      { role: "system", content: "You are a seat on a trading council ranking other seats' analyses." },
      { role: "user", content: stage2UserPrompt(anonymizedTexts) },
    ];
    return {
      seat: s.seat,
      model: s.model,
      provider: s.provider,
      opts: { max_tokens: 600 },
      messages,
    };
  });

  const stage2Outcomes = await llm.callModelsParallel(stage2Specs);
  const stage2Rankings: Array<{ seat: string; model: string; ranking: string[] }> = [];
  stage2Outcomes.forEach((outcome, i) => {
    const ref = stage1[i];
    if (!ref || outcome.ok === false) return;
    try {
      const ranking = parseStage2Ranking(outcome.text, stage1.length);
      stage2Rankings.push({ seat: ref.seat, model: ref.model, ranking });
    } catch {
      // skip malformed ranking
    }
  });

  // Translate label rankings ("A","B"...) to model names for the chair view.
  const labelToModel: Record<string, string> = {};
  stage1.forEach((s, i) => {
    const lbl = labels[i];
    if (lbl) labelToModel[lbl] = s.model;
  });
  const stage2RankingsForChair = stage2Rankings.map((r) => ({
    seat: r.seat,
    model: r.model,
    ranking: r.ranking.map((lbl) => labelToModel[lbl] ?? lbl),
  }));

  // Stage 3 — chair synthesis
  const chairProvider = input.chairman_provider
    ?? (input.council_seats.find((s) => s.model === input.chairman_model)?.provider);

  const chairPrompt = stage3UserPrompt(input, stage1.map((s) => ({
    seat: s.seat,
    model: s.model,
    stance: s.stance,
    text: s.text,
  })), stage2RankingsForChair);

  // Chair JSON output (verdict/pros/cons/disagreement_points/model_rankings) is
  // structurally larger than Stage-1 envelopes — give it 2x budget to avoid
  // truncated/unparseable responses.
  const chairOutcome = await llm.callModel(
    input.chairman_model,
    [
      { role: "system", content: "You are the chair of a trading council. Output strict JSON." },
      { role: "user", content: chairPrompt },
    ],
    { max_tokens: input.max_tokens_per_call * 2 },
    chairProvider,
  );

  if (chairOutcome.ok === false) {
    return {
      ticker: input.candidate.ticker,
      verdict: "HOLD",
      conviction: "LOW",
      consensus_met: false,
      recommendation: "Council chair unavailable, defer to TradingAgents",
      stage1_voices: stage1.length,
      failures: [...failures, { seat: "chair", model: chairOutcome.model, error: chairOutcome.error }],
      chair_failed: true,
    };
  }

  const chairText = chairOutcome.text;
  let synthesis: Stage3Envelope;
  try {
    synthesis = parseStage3(chairText);
  } catch (e) {
    return {
      ticker: input.candidate.ticker,
      verdict: "HOLD",
      conviction: "LOW",
      consensus_met: false,
      recommendation: "Council chair returned malformed synthesis; defer",
      stage1_voices: stage1.length,
      chair_parse_error: (e as Error).message,
      chair_raw: chairText.slice(0, 500),
    };
  }

  // Tally for visibility — independent of chair claim.
  const verdictTally: Record<string, number> = { BUY: 0, HOLD: 0, SELL: 0 };
  for (const s of stage1) {
    const v = s.parsed?.verdict;
    if (v && v in verdictTally) verdictTally[v] = (verdictTally[v] ?? 0) + 1;
  }
  const topVote = Math.max(verdictTally.BUY ?? 0, verdictTally.HOLD ?? 0, verdictTally.SELL ?? 0);
  const consensus_observed = topVote >= input.consensus_threshold;

  return {
    ticker: input.candidate.ticker,
    verdict: synthesis.verdict,
    conviction: synthesis.conviction,
    consensus_met: synthesis.consensus_met,
    consensus_observed,
    consensus_threshold: input.consensus_threshold,
    agreement_score: synthesis.agreement_score,
    pros: synthesis.pros,
    cons: synthesis.cons,
    recommendation: synthesis.recommendation,
    sizing_note: synthesis.sizing_note,
    disagreement_points: synthesis.disagreement_points,
    model_rankings: synthesis.model_rankings,
    stage1_voices: stage1.length,
    stage1_verdict_tally: verdictTally,
    stage1_failures: failures,
    council_size: input.council_seats.length,
  };
}
