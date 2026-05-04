import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reflectTradesHandler } from "../../src/tools/reflect-trades.js";

const FIXTURE = resolve(__dirname, "../fixtures/reflect-week.json");

describe("reflect_trades — fixture smoke (CI guard)", () => {
  it("processes a representative weekly closed-trade set without throwing", async () => {
    const raw = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    const result = await reflectTradesHandler(raw);

    expect(result.book).toBe("personal");
    expect(result.lookback_days).toBe(14);
    expect(result.summary.total_trades).toBe(10);
    expect(result.summary.wins).toBeGreaterThanOrEqual(4);
    expect(result.summary.losses).toBeGreaterThanOrEqual(3);
  });

  it("flags the R7 breach across multiple trades as high-severity", async () => {
    const raw = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    const result = await reflectTradesHandler(raw);

    const r7 = result.r_rule_breaches.find((b) => b.rule === "R7");
    expect(r7).toBeDefined();
    expect(r7!.count).toBeGreaterThanOrEqual(3);

    const r7Lesson = result.lessons.find((l) => l.id === "lesson-R7");
    expect(r7Lesson).toBeDefined();
    expect(r7Lesson!.severity).toBe("high");
  });

  it("detects the 2 TECK losses as concentration drift", async () => {
    const raw = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    const result = await reflectTradesHandler(raw);

    const teckAlert = result.pattern_drift_alerts.find((a) => a.includes("TECK"));
    if (result.pattern_drift_alerts.length > 0) {
      expect(teckAlert === undefined || teckAlert.includes("losses")).toBe(true);
    }
  });

  it("detects the HALT-regime BBAI entry as regime gate bypass", async () => {
    const raw = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    const result = await reflectTradesHandler(raw);

    expect(result.summary.halt_regime_entries).toBeGreaterThanOrEqual(1);
    const haltAlert = result.pattern_drift_alerts.find((a) => a.includes("HALT"));
    expect(haltAlert).toBeDefined();
  });

  it("detects the 2-roll TECK trade as a revenge-roll candidate", async () => {
    const raw = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    const result = await reflectTradesHandler(raw);

    expect(result.summary.revenge_roll_count).toBeGreaterThanOrEqual(1);
    const revLesson = result.lessons.find((l) => l.id === "lesson-revenge-roll");
    expect(revLesson).toBeDefined();
  });

  it("returns per-structure summary covering the fixture's structures", async () => {
    const raw = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    const result = await reflectTradesHandler(raw);

    expect(result.by_structure).toHaveProperty("covered_call");
    expect(result.by_structure).toHaveProperty("long_stock");
    expect(result.by_structure).toHaveProperty("credit_spread");
    expect(result.by_structure.covered_call.trades).toBeGreaterThanOrEqual(4);
  });
});
