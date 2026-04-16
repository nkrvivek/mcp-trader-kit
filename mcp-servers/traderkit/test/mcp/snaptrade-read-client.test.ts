import { describe, it, expect } from "vitest";
import { extractActivities, type Activity } from "../../src/mcp/snaptrade-read-client.js";

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("extractActivities", () => {
  it("parses a raw array of activities", () => {
    const sample: Activity[] = [
      {
        symbol: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150,
        trade_date: "2026-01-15",
        account_id: "acc-1",
      },
    ];
    expect(extractActivities(textResult(JSON.stringify(sample)))).toEqual(sample);
  });

  it("parses {activities: [...]} envelope", () => {
    const sample: Activity[] = [
      {
        symbol: "MSFT",
        action: "SELL",
        quantity: 5,
        price: 400,
        realized_pnl: -250,
        trade_date: "2026-02-01",
        account_id: "acc-2",
      },
    ];
    const res = extractActivities(textResult(JSON.stringify({ activities: sample })));
    expect(res).toEqual(sample);
  });

  it("returns [] for an object without activities field", () => {
    expect(extractActivities(textResult(JSON.stringify({ other: 1 })))).toEqual([]);
  });

  it("returns [] on malformed JSON", () => {
    expect(extractActivities(textResult("{not json"))).toEqual([]);
  });

  it("returns [] when text block is missing", () => {
    expect(extractActivities({ content: [{ type: "image" }] })).toEqual([]);
  });

  it("returns [] when content is missing", () => {
    expect(extractActivities({})).toEqual([]);
    expect(extractActivities(null)).toEqual([]);
    expect(extractActivities(undefined)).toEqual([]);
  });

  it("returns [] when text block is empty", () => {
    expect(extractActivities(textResult(""))).toEqual([]);
  });
});
