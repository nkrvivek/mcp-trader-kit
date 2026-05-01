import { describe, expect, it } from "vitest";
import {
  toIsoDate,
  isTradingDay,
  nextTradingDay,
  prevTradingDay,
  getLastNTradingDays,
  getTradingDayProgress,
  holidaysForYear,
} from "../../src/utils/calendar.js";

describe("calendar", () => {
  it("toIsoDate formats date as YYYY-MM-DD", () => {
    expect(toIsoDate(new Date(2026, 4, 1))).toBe("2026-05-01");
  });

  it("isTradingDay returns false for weekends", () => {
    // 2026-05-02 is Saturday, 2026-05-03 is Sunday
    expect(isTradingDay(new Date(2026, 4, 2))).toBe(false);
    expect(isTradingDay(new Date(2026, 4, 3))).toBe(false);
  });

  it("isTradingDay returns false for holidays (Christmas)", () => {
    expect(isTradingDay(new Date(2026, 11, 25))).toBe(false);
  });

  it("isTradingDay returns true for normal weekdays", () => {
    // 2026-05-01 is a Friday
    expect(isTradingDay(new Date(2026, 4, 1))).toBe(true);
  });

  it("nextTradingDay skips weekends", () => {
    // Friday 2026-05-01 → Monday 2026-05-04
    const next = nextTradingDay(new Date(2026, 4, 1));
    expect(toIsoDate(next)).toBe("2026-05-04");
  });

  it("prevTradingDay skips weekends", () => {
    // Monday 2026-05-04 → Friday 2026-05-01
    const prev = prevTradingDay(new Date(2026, 4, 4));
    expect(toIsoDate(prev)).toBe("2026-05-01");
  });

  it("getLastNTradingDays returns n trading days ending on previous trading day", () => {
    // From Friday 2026-05-01, "last 3" means [Apr-30, Apr-29, Apr-28]
    const days = getLastNTradingDays(3, new Date(2026, 4, 1, 12));
    expect(days).toHaveLength(3);
    expect(days[0]).toBe("2026-04-30");
    expect(days[1]).toBe("2026-04-29");
    expect(days[2]).toBe("2026-04-28");
  });

  it("holidaysForYear includes major US holidays", () => {
    const holidays = holidaysForYear(2026);
    // Independence Day, Christmas, New Year's
    expect(holidays.has("2026-07-03")).toBe(true); // observed (July 4 = Saturday)
    expect(holidays.has("2026-12-25")).toBe(true);
    expect(holidays.has("2026-01-01")).toBe(true);
  });

  it("getTradingDayProgress returns 0 pre-market", () => {
    // Pick a Friday at 8:00 ET
    const r = getTradingDayProgress(new Date("2026-05-01T12:00:00Z")); // 08:00 ET (DST)
    expect(r.progress).toBe(0);
    expect(r.is_market_hours).toBe(false);
    expect(r.status).toContain("Pre-market");
  });

  it("getTradingDayProgress returns 1 after-hours", () => {
    // Friday 16:30 ET
    const r = getTradingDayProgress(new Date("2026-05-01T20:30:00Z"));
    expect(r.progress).toBe(1.0);
    expect(r.is_market_hours).toBe(false);
    expect(r.status).toContain("After hours");
  });

  it("getTradingDayProgress returns 1 on weekend", () => {
    const r = getTradingDayProgress(new Date("2026-05-02T17:00:00Z"));
    expect(r.progress).toBe(1.0);
    expect(r.status).toContain("Market closed");
  });
});
