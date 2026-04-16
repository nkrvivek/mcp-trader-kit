import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";

const FitScore = z.enum(["IN_THESIS", "PARTIAL", "OFF_THESIS", "NO_THESIS_REF"]);
type FitScore = z.infer<typeof FitScore>;

const ThesisEntry = z.object({
  thesis_id: z.string().min(1),
  tickers: z.array(TickerSchema),
  structures: z.array(z.string().min(1)).default([]),
  status: z.enum(["active", "paused", "closed"]).default("active"),
});

export const ThesisFitArgs = z.object({
  action: z.enum(["score_fit", "batch_score"]),
  ticker: TickerSchema.optional(),
  thesis_ref: z.string().optional(),
  structure: z.string().optional(),
  theses: z.array(ThesisEntry),
  holdings: z.array(z.object({
    ticker: TickerSchema,
    thesis_ref: z.string().optional(),
    structure: z.string().optional(),
  })).optional(),
});

function scoreFit(
  ticker: string,
  thesisRef: string | undefined,
  structure: string | undefined,
  theses: z.infer<typeof ThesisEntry>[],
): { score: FitScore; thesis_id: string | null; detail: string } {
  if (!thesisRef) {
    return { score: "NO_THESIS_REF", thesis_id: null, detail: "no thesis_ref provided" };
  }

  const thesis = theses.find((t) => t.thesis_id === thesisRef);
  if (!thesis) {
    return { score: "OFF_THESIS", thesis_id: thesisRef, detail: `thesis ${thesisRef} not found` };
  }

  if (thesis.status === "closed") {
    return { score: "OFF_THESIS", thesis_id: thesisRef, detail: `thesis ${thesisRef} is closed` };
  }

  const tickerUpper = ticker.toUpperCase();
  if (!thesis.tickers.some((t) => t.toUpperCase() === tickerUpper)) {
    return { score: "OFF_THESIS", thesis_id: thesisRef, detail: `${ticker} not in thesis ${thesisRef} tickers` };
  }

  if (structure && thesis.structures.length > 0) {
    const structLower = structure.toLowerCase();
    if (!thesis.structures.some((s) => s.toLowerCase() === structLower)) {
      return { score: "PARTIAL", thesis_id: thesisRef, detail: `structure ${structure} not in thesis allowed structures` };
    }
  }

  return { score: "IN_THESIS", thesis_id: thesisRef, detail: "fully aligned" };
}

export async function thesisFitHandler(raw: unknown) {
  const args = ThesisFitArgs.parse(raw);

  switch (args.action) {
    case "score_fit": {
      if (!args.ticker) return { error: "ticker required for score_fit" };
      const result = scoreFit(args.ticker, args.thesis_ref, args.structure, args.theses);
      return { ticker: args.ticker, ...result };
    }

    case "batch_score": {
      if (!args.holdings) return { error: "holdings required for batch_score" };
      const results = args.holdings.map((h) => ({
        ticker: h.ticker,
        ...scoreFit(h.ticker, h.thesis_ref, h.structure, args.theses),
      }));

      const summary = {
        in_thesis: results.filter((r) => r.score === "IN_THESIS").length,
        partial: results.filter((r) => r.score === "PARTIAL").length,
        off_thesis: results.filter((r) => r.score === "OFF_THESIS").length,
        no_ref: results.filter((r) => r.score === "NO_THESIS_REF").length,
      };

      return { results, summary };
    }
  }
}
