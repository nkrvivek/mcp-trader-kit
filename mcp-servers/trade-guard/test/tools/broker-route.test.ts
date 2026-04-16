import { describe, expect, it } from "vitest";
import { brokerRouteHandler } from "../../src/tools/broker-route.js";

describe("brokerRouteHandler", () => {
  it("routes Fidelity via SNAPTRADE", async () => {
    const r: any = await brokerRouteHandler({ broker: "fidelity", direction: "BUY" });
    expect(r.route).toBe("SNAPTRADE");
  });

  it("routes E-Trade via SNAPTRADE", async () => {
    const r: any = await brokerRouteHandler({ broker: "e-trade", direction: "SELL" });
    expect(r.route).toBe("SNAPTRADE");
  });

  it("routes TradeStation via TRADESTATION", async () => {
    const r: any = await brokerRouteHandler({ broker: "tradestation", direction: "BUY" });
    expect(r.route).toBe("TRADESTATION");
  });

  it("routes Ally as MANUAL", async () => {
    const r: any = await brokerRouteHandler({ broker: "ally", direction: "BUY" });
    expect(r.route).toBe("MANUAL");
  });

  it("deferred tags override broker classification", async () => {
    const r: any = await brokerRouteHandler({ broker: "fidelity", direction: "BUY", deferred_tags: ["ibkr-tuesday"] });
    expect(r.route).toBe("DEFERRED");
    expect(r.detail).toContain("ibkr-tuesday");
  });

  it("unknown broker falls back to MANUAL", async () => {
    const r: any = await brokerRouteHandler({ broker: "unknown-broker", direction: "BUY" });
    expect(r.route).toBe("MANUAL");
    expect(r.detail).toContain("fallback");
  });

  it("handles case-insensitive broker names", async () => {
    const r: any = await brokerRouteHandler({ broker: "IBKR", direction: "SELL" });
    expect(r.route).toBe("SNAPTRADE");
  });

  it("routes TS shorthand via TRADESTATION", async () => {
    const r: any = await brokerRouteHandler({ broker: "ts", direction: "BUY" });
    expect(r.route).toBe("TRADESTATION");
  });
});
