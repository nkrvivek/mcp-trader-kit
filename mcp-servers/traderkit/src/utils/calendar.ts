function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateFromIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
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

export function holidaysForYear(year: number): Set<string> {
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
  const set = new Set(raw.map((d) => toIsoDate(observed(d))));
  holidayCache.set(year, set);
  return set;
}

export function isTradingDay(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  return !holidaysForYear(d.getFullYear()).has(toIsoDate(d));
}

export function nextTradingDay(d: Date): Date {
  let cursor = addDays(d, 1);
  while (!isTradingDay(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

export function prevTradingDay(d: Date): Date {
  let cursor = addDays(d, -1);
  while (!isTradingDay(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

export function lastTradingDayOfMonth(year: number, month: number): Date {
  let d = new Date(year, month, 0);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}

export function getLastNTradingDays(n: number, fromDate?: Date): string[] {
  let cursor = fromDate ? new Date(fromDate) : new Date();
  // start from previous trading day (matches radon: skips today before close)
  cursor = prevTradingDay(cursor);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(toIsoDate(cursor));
    cursor = prevTradingDay(cursor);
  }
  return out;
}

export interface TradingDayProgress {
  progress: number;
  is_market_hours: boolean;
  status: string;
}

export function getTradingDayProgress(now?: Date): TradingDayProgress {
  const ref = now ?? new Date();
  const etParts = etDateParts(ref);
  const etDate = new Date(etParts.y, etParts.m - 1, etParts.d);

  if (!isTradingDay(etDate)) {
    return { progress: 1.0, is_market_hours: false, status: "Market closed (weekend/holiday)" };
  }

  const minutes = etParts.hh * 60 + etParts.mm;
  const openMin = 9 * 60 + 30;
  const closeMin = 16 * 60;

  if (minutes < openMin) {
    return { progress: 0.0, is_market_hours: false, status: "Pre-market (before 9:30 AM ET)" };
  }
  if (minutes >= closeMin) {
    return { progress: 1.0, is_market_hours: false, status: "After hours (market closed)" };
  }

  const elapsed = minutes - openMin;
  const total = closeMin - openMin;
  const progress = Math.min(elapsed / total, 1.0);
  const hours = elapsed / 60;
  return {
    progress,
    is_market_hours: true,
    status: `Market open (${hours.toFixed(1)}h elapsed, ${(progress * 100).toFixed(0)}% of day)`,
  };
}

function etDateParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  let hh = get("hour");
  if (hh === 24) hh = 0;
  return { y: get("year"), m: get("month"), d: get("day"), hh, mm: get("minute") };
}
