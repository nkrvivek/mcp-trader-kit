export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const MS_PER_DAY = 86_400_000;

export function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate}T16:00:00-04:00`).getTime();
  return Math.round((target - Date.now()) / MS_PER_DAY);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T16:00:00-04:00`).getTime();
  const b = new Date(`${toIso}T16:00:00-04:00`).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}
