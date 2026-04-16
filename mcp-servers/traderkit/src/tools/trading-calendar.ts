import { z } from "zod";
import { IsoDateSchema } from "../utils/schemas.js";

export const TradingCalendarArgs = z.object({
  action: z.enum(["is_trading_day", "next_trading_day", "prev_trading_day", "last_trading_day_of_month", "trading_days_between"]),
  date: IsoDateSchema,
  end_date: IsoDateSchema.optional(),
});

function dateFromStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month - 1, 1);
  const firstDay = first.getDay();
  const offset = (weekday - firstDay + 7) % 7;
  return new Date(year, month - 1, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const lastDay = new Date(year, month, 0);
  let d = new Date(lastDay);
  while (d.getDay() !== weekday) d = addDays(d, -1);
  return d;
}

function goodFriday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return addDays(new Date(year, month - 1, day), -2);
}

function observed(d: Date): Date {
  if (d.getDay() === 6) return addDays(d, -1);
  if (d.getDay() === 0) return addDays(d, 1);
  return d;
}

const holidayCache = new Map<number, Set<string>>();

function holidaysForYear(year: number): Set<string> {
  if (holidayCache.has(year)) return holidayCache.get(year)!;
  const raw = [
    new Date(year, 0, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    goodFriday(year),
    lastWeekday(year, 5, 1),
    new Date(year, 5, 19),
    new Date(year, 6, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    new Date(year, 11, 25),
  ];
  const set = new Set(raw.map((d) => toISO(observed(d))));
  holidayCache.set(year, set);
  return set;
}

function isTradingDay(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  return !holidaysForYear(d.getFullYear()).has(toISO(d));
}

function nextTradingDay(d: Date): Date {
  let cursor = addDays(d, 1);
  while (!isTradingDay(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

function prevTradingDay(d: Date): Date {
  let cursor = addDays(d, -1);
  while (!isTradingDay(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

function lastTradingDayOfMonth(year: number, month: number): Date {
  let d = new Date(year, month, 0);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}

export async function tradingCalendarHandler(raw: unknown) {
  const args = TradingCalendarArgs.parse(raw);
  const d = dateFromStr(args.date);

  switch (args.action) {
    case "is_trading_day":
      return { date: args.date, is_trading_day: isTradingDay(d), day_of_week: d.toLocaleDateString("en-US", { weekday: "long" }) };

    case "next_trading_day": {
      const next = nextTradingDay(d);
      return { from: args.date, next_trading_day: toISO(next) };
    }

    case "prev_trading_day": {
      const prev = prevTradingDay(d);
      return { from: args.date, prev_trading_day: toISO(prev) };
    }

    case "last_trading_day_of_month": {
      const last = lastTradingDayOfMonth(d.getFullYear(), d.getMonth() + 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1, last_trading_day: toISO(last) };
    }

    case "trading_days_between": {
      if (!args.end_date) return { error: "end_date required for trading_days_between" };
      const end = dateFromStr(args.end_date);
      let count = 0;
      let cursor = new Date(d);
      while (cursor <= end) {
        if (isTradingDay(cursor)) count++;
        cursor = addDays(cursor, 1);
      }
      return { from: args.date, to: args.end_date, trading_days: count };
    }
  }
}
