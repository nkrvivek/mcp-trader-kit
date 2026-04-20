export interface Stamped {
  as_of?: string;
}

export interface StalenessResult {
  stale: boolean;
  age_sec: number | null;
  detail: string;
}

export function checkStale(
  field: string,
  asOf: string | undefined,
  ttlSec: number,
  now: Date = new Date()
): StalenessResult {
  if (!asOf) {
    return { stale: true, age_sec: null, detail: `${field}: no as_of timestamp` };
  }
  const ts = Date.parse(asOf);
  if (Number.isNaN(ts)) {
    return { stale: true, age_sec: null, detail: `${field}: invalid as_of (${asOf})` };
  }
  const ageSec = Math.round((now.getTime() - ts) / 1000);
  if (ageSec > ttlSec) {
    return { stale: true, age_sec: ageSec, detail: `${field}: ${ageSec}s old > ttl ${ttlSec}s` };
  }
  return { stale: false, age_sec: ageSec, detail: `${field}: fresh (${ageSec}s)` };
}

export const DEFAULT_TTL_SEC = {
  quote: 60,
  strike_grid: 60,
  regime: 15 * 60,
  portfolio_total: 4 * 60 * 60,
  activities: 24 * 60 * 60,
} as const;
