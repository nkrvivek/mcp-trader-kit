// LLM client for the council tool.
// Direct provider routing via fetch — no SDK dependency.
// Providers: Anthropic Messages API + OpenAI Chat Completions API.
// Mirrors Karpathy llm-council/openrouter.py shape: callModel + callModelsParallel.

import { toMessage } from "../utils/errors.js";

export type Provider = "anthropic" | "openai" | "google";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCallOptions {
  max_tokens?: number;
  temperature?: number;
  timeout_ms?: number;
}

export interface LlmCallResult {
  model: string;
  provider: Provider;
  text: string;
  ok: true;
}

export interface LlmCallError {
  model: string;
  provider: Provider;
  error: string;
  ok: false;
}

export type LlmCallOutcome = LlmCallResult | LlmCallError;

const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE ?? "https://api.anthropic.com";
const OPENAI_BASE = process.env.OPENAI_BASE ?? "https://api.openai.com";
const GEMINI_BASE = process.env.GEMINI_BASE ?? "https://generativelanguage.googleapis.com";

const DEFAULT_MAX_TOKENS = 1500;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_TIMEOUT_MS = 120_000;

export function inferProvider(model: string): Provider {
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|o\d|chatgpt)/i.test(model)) return "openai";
  if (/^gemini/i.test(model)) return "google";
  // default to openai if unknown
  return "openai";
}

function sanitizeBody(body: string, ...secrets: (string | undefined)[]): string {
  let out = body;
  for (const s of secrets) {
    if (s && s.length > 4) out = out.split(s).join("[redacted]");
  }
  return out.slice(0, 300);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeout_ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout_ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// Newer Anthropic reasoning models (Opus 4.x, future) reject `temperature` w/ a
// 400 "temperature is deprecated for this model" error. Detect by model name
// and omit the param for those families.
function anthropicSupportsTemperature(model: string): boolean {
  if (/opus-4-\d/i.test(model)) return false;
  return true;
}

async function callAnthropic(model: string, messages: LlmMessage[], opts: LlmCallOptions): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.max_tokens ?? DEFAULT_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: turns,
  };
  if (anthropicSupportsTemperature(model)) {
    body.temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  }

  const res = await fetchWithTimeout(
    `${ANTHROPIC_BASE}/v1/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    },
    opts.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${sanitizeBody(txt, key)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (json.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  if (!text) throw new Error("anthropic: empty content");
  return text;
}

async function callOpenAI(model: string, messages: LlmMessage[], opts: LlmCallOptions): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const body = {
    model,
    max_completion_tokens: opts.max_tokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  const res = await fetchWithTimeout(
    `${OPENAI_BASE}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    },
    opts.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`openai ${res.status}: ${sanitizeBody(txt, key)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("openai: empty content");
  return text;
}

async function callGoogle(model: string, messages: LlmMessage[], opts: LlmCallOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  // Gemini 3.x reasoning models eat most of `maxOutputTokens` on internal
  // thinking, leaving truncated JSON for the actual reply. Cap thinking budget
  // to ~10% of output budget so the structured response always completes.
  const isThinkingModel = /gemini-(3|2\.5)/i.test(model);
  const maxOutputTokens = opts.max_tokens ?? DEFAULT_MAX_TOKENS;

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      ...(isThinkingModel ? { thinkingConfig: { thinkingBudget: Math.max(128, Math.floor(maxOutputTokens * 0.1)) } } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const url = `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    opts.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`google ${res.status}: ${sanitizeBody(txt, key)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (json.candidates ?? [])
    .flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  if (!text) throw new Error("google: empty content");
  return text;
}

export async function callModel(
  model: string,
  messages: LlmMessage[],
  opts: LlmCallOptions = {},
  providerOverride?: Provider,
): Promise<LlmCallOutcome> {
  const provider = providerOverride ?? inferProvider(model);
  try {
    let text: string;
    if (provider === "anthropic") {
      text = await callAnthropic(model, messages, opts);
    } else if (provider === "google") {
      text = await callGoogle(model, messages, opts);
    } else {
      text = await callOpenAI(model, messages, opts);
    }
    return { model, provider, text, ok: true };
  } catch (e) {
    return { model, provider, error: toMessage(e), ok: false };
  }
}

export interface ParallelCallSpec {
  model: string;
  messages: LlmMessage[];
  provider?: Provider;
  opts?: LlmCallOptions;
  // Caller-chosen seat label, propagated through to the result.
  seat?: string;
}

export type ParallelCallOutcome =
  | (LlmCallResult & { seat?: string })
  | (LlmCallError & { seat?: string });

export async function callModelsParallel(specs: ParallelCallSpec[]): Promise<ParallelCallOutcome[]> {
  const settled = await Promise.allSettled(
    specs.map((s) => callModel(s.model, s.messages, s.opts ?? {}, s.provider)),
  );
  return settled.map((r, i): ParallelCallOutcome => {
    const seat = specs[i]?.seat;
    if (r.status === "fulfilled") {
      return seat !== undefined ? { ...r.value, seat } : r.value;
    }
    const model = specs[i]?.model ?? "unknown";
    const provider = specs[i]?.provider ?? inferProvider(model);
    const err: LlmCallError = { ok: false, model, provider, error: toMessage(r.reason) };
    return seat !== undefined ? { ...err, seat } : err;
  });
}

// Test seam — let test code swap network calls for a stub.
export interface LlmCaller {
  callModel: typeof callModel;
  callModelsParallel: typeof callModelsParallel;
}

export const liveLlmCaller: LlmCaller = { callModel, callModelsParallel };
