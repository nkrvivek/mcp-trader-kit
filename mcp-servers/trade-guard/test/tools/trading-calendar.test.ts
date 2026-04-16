import { describe, expect, it } from "vitest";
import { tradingCalendarHandler } from "../../src/tools/trading-calendar.js";

describe("tradingCalendarHandler", () => {
  it("identifies a weekday as a trading day", async () => {
    const r = await tradingCalendarHandler({ action: "is_trading_day", date: "2026-04-14" });
    expect(r).toMatchObject({ is_trading_day: true });
  });

  it("identifies a weekend as non-trading", async () => {
    const r = await tradingCalendarHandler({ action: "is_trading_day", date: "2026-04-11" });
    expect(r).toMatchObject({ is_trading_day: false });
  });

  it("identifies Christmas as non-trading", async () => {
    const r = await tradingCalendarHandler({ action: "is_trading_day", date: "2025-12-25" });
    expect(r).toMatchObject({ is_trading_day: false });
  });

  it("identifies Good Friday as non-trading", async () => {
    const r = await tradingCalendarHandler({ action: "is_trading_day", date: "2026-04-03" });
    expect(r).toMatchObject({ is_trading_day: false });
  });

  it("finds next trading day from Friday", async () => {
    const r = await tradingCalendarHandler({ action: "next_trading_day", date: "2026-04-10" });
    expect(r).toMatchObject({ next_trading_day: "2026-04-13" });
  });

  it("finds prev trading day from Monday", async () => {
    const r = await tradingCalendarHandler({ action: "prev_trading_day", date: "2026-04-13" });
    expect(r).toMatchObject({ prev_trading_day: "2026-04-10" });
  });

  it("finds last trading day of month", async () => {
    const r = await tradingCalendarHandler({ action: "last_trading_day_of_month", date: "2026-04-01" });
    expect(r).toMatchObject({ last_trading_day: "2026-04-30" });
  });

  it("counts trading days between dates", async () => {
    const r = await tradingCalendarHandler({ action: "trading_days_between", date: "2026-04-13", end_date: "2026-04-17" });
    expect(r).toMatchObject({ trading_days: 5 });
  });

  it("requires end_date for trading_days_between", async () => {
    const r = await tradingCalendarHandler({ action: "trading_days_between", date: "2026-04-13" });
    expect(r).toMatchObject({ error: "end_date required for trading_days_between" });
  });

  it("handles observed holiday (July 4 on Saturday → Friday off)", async () => {
    const r = await tradingCalendarHandler({ action: "is_trading_day", date: "2026-07-03" });
    expect(r).toMatchObject({ is_trading_day: false });
  });
});
