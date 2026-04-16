import { describe, expect, it } from "vitest";
import { thesisFitHandler } from "../../src/tools/thesis-fit.js";

const THESES = [
  { thesis_id: "silver-squeeze", tickers: ["SLV", "AG", "PAAS"], structures: ["long_equity", "call_spread"], status: "active" as const },
  { thesis_id: "aapl-cc-ladder", tickers: ["AAPL"], structures: ["covered_call"], status: "active" as const },
  { thesis_id: "intc-close-lesson", tickers: ["INTC"], structures: [], status: "closed" as const },
];

describe("thesisFitHandler — score_fit", () => {
  it("returns IN_THESIS for matching ticker + structure", async () => {
    const r: any = await thesisFitHandler({
      action: "score_fit", ticker: "SLV", thesis_ref: "silver-squeeze", structure: "long_equity", theses: THESES,
    });
    expect(r.score).toBe("IN_THESIS");
  });

  it("returns PARTIAL for matching ticker but wrong structure", async () => {
    const r: any = await thesisFitHandler({
      action: "score_fit", ticker: "SLV", thesis_ref: "silver-squeeze", structure: "naked_put", theses: THESES,
    });
    expect(r.score).toBe("PARTIAL");
  });

  it("returns OFF_THESIS for ticker not in thesis", async () => {
    const r: any = await thesisFitHandler({
      action: "score_fit", ticker: "MSFT", thesis_ref: "silver-squeeze", theses: THESES,
    });
    expect(r.score).toBe("OFF_THESIS");
  });

  it("returns NO_THESIS_REF when no thesis_ref provided", async () => {
    const r: any = await thesisFitHandler({
      action: "score_fit", ticker: "SLV", theses: THESES,
    });
    expect(r.score).toBe("NO_THESIS_REF");
  });

  it("returns OFF_THESIS for closed thesis", async () => {
    const r: any = await thesisFitHandler({
      action: "score_fit", ticker: "INTC", thesis_ref: "intc-close-lesson", theses: THESES,
    });
    expect(r.score).toBe("OFF_THESIS");
    expect(r.detail).toMatch(/closed/);
  });

  it("returns OFF_THESIS for unknown thesis_ref", async () => {
    const r: any = await thesisFitHandler({
      action: "score_fit", ticker: "SLV", thesis_ref: "nonexistent", theses: THESES,
    });
    expect(r.score).toBe("OFF_THESIS");
  });

  it("returns IN_THESIS when no structures defined on thesis", async () => {
    const r: any = await thesisFitHandler({
      action: "score_fit", ticker: "AAPL", thesis_ref: "aapl-cc-ladder", structure: "anything", theses: [
        { thesis_id: "aapl-cc-ladder", tickers: ["AAPL"], structures: [], status: "active" as const },
      ],
    });
    expect(r.score).toBe("IN_THESIS");
  });
});

describe("thesisFitHandler — batch_score", () => {
  it("scores multiple holdings and returns summary", async () => {
    const r: any = await thesisFitHandler({
      action: "batch_score",
      theses: THESES,
      holdings: [
        { ticker: "SLV", thesis_ref: "silver-squeeze", structure: "long_equity" },
        { ticker: "AAPL", thesis_ref: "aapl-cc-ladder", structure: "covered_call" },
        { ticker: "MSFT" },
        { ticker: "INTC", thesis_ref: "intc-close-lesson" },
      ],
    });
    expect(r.summary.in_thesis).toBe(2);
    expect(r.summary.no_ref).toBe(1);
    expect(r.summary.off_thesis).toBe(1);
    expect(r.results).toHaveLength(4);
  });

  it("requires holdings array", async () => {
    const r: any = await thesisFitHandler({ action: "batch_score", theses: THESES });
    expect(r.error).toMatch(/holdings required/);
  });
});
