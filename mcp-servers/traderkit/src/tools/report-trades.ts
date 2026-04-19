import { z } from "zod";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { round } from "../utils/math.js";

export const ReportTradesArgs = z.object({
  since_days: z.number().positive().default(7),
  profile: z.string().optional(),
  mode: z.enum(["interactive", "dry-run", "scheduled"]).optional(),
  include_dry_run: z.boolean().default(false),
});

type ExecutedTrade = {
  ticker: string;
  direction?: string;
  qty?: number;
  price?: number;
  broker?: string;
  order_id?: string;
  thesis_ref?: string;
  structure?: string;
  premium_usd?: number;
  realized_pnl_usd?: number;
};

type SessionRecord = {
  session_id: string;
  profile: string;
  mode: string;
  date: string;
  nav?: number;
  regime_tier?: string;
  executed?: ExecutedTrade[];
  deferred?: unknown[];
  no_trades?: unknown[];
};

function getLocalSessionsDir(): string {
  const root = process.env.TRADERKIT_HOME ?? join(homedir(), ".traderkit");
  return join(root, "sessions");
}

function listSessionJsonFiles(root: string, sinceMs: number): string[] {
  const paths: string[] = [];
  let dateDirs: string[];
  try {
    dateDirs = readdirSync(root);
  } catch {
    return [];
  }
  for (const dateDir of dateDirs) {
    const dateDirPath = join(root, dateDir);
    let st;
    try { st = statSync(dateDirPath); } catch { continue; }
    if (!st.isDirectory()) continue;
    let entries: string[];
    try { entries = readdirSync(dateDirPath); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const full = join(dateDirPath, entry);
      let fileSt;
      try { fileSt = statSync(full); } catch { continue; }
      if (fileSt.mtimeMs < sinceMs) continue;
      paths.push(full);
    }
  }
  return paths;
}

function loadSession(path: string): SessionRecord | null {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export async function reportTradesHandler(raw: unknown) {
  const args = ReportTradesArgs.parse(raw);
  const root = getLocalSessionsDir();
  const sinceMs = Date.now() - args.since_days * 24 * 60 * 60 * 1000;

  const files = listSessionJsonFiles(root, sinceMs);
  if (files.length === 0) {
    return {
      local_root: root,
      since_days: args.since_days,
      sessions_found: 0,
      message: `No sessions in last ${args.since_days} day(s) at ${root}. Run /trade to persist first.`,
    };
  }

  const sessions = files.map(loadSession).filter((s): s is SessionRecord => s !== null);

  const filtered = sessions.filter((s) => {
    if (args.profile && s.profile !== args.profile) return false;
    if (args.mode && s.mode !== args.mode) return false;
    if (!args.include_dry_run && s.mode === "dry-run") return false;
    return true;
  });

  const executed: ExecutedTrade[] = [];
  for (const s of filtered) {
    for (const t of s.executed ?? []) executed.push(t);
  }

  const byStructure: Record<string, { count: number; premium_usd: number; pnl_usd: number }> = {};
  const byTicker: Record<string, { count: number; pnl_usd: number }> = {};
  const byRegime: Record<string, { sessions: number; trades: number }> = {};

  let totalPremium = 0;
  let totalRealizedPnl = 0;
  let wins = 0;
  let losses = 0;

  for (const t of executed) {
    const structure = t.structure ?? t.direction ?? "unknown";
    const premium = t.premium_usd ?? 0;
    const pnl = t.realized_pnl_usd ?? 0;
    totalPremium += premium;
    totalRealizedPnl += pnl;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;

    if (!byStructure[structure]) byStructure[structure] = { count: 0, premium_usd: 0, pnl_usd: 0 };
    byStructure[structure]!.count++;
    byStructure[structure]!.premium_usd += premium;
    byStructure[structure]!.pnl_usd += pnl;

    if (!byTicker[t.ticker]) byTicker[t.ticker] = { count: 0, pnl_usd: 0 };
    byTicker[t.ticker]!.count++;
    byTicker[t.ticker]!.pnl_usd += pnl;
  }

  for (const s of filtered) {
    const tier = s.regime_tier ?? "UNKNOWN";
    if (!byRegime[tier]) byRegime[tier] = { sessions: 0, trades: 0 };
    byRegime[tier]!.sessions++;
    byRegime[tier]!.trades += (s.executed ?? []).length;
  }

  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;

  const roundStruct = (obj: Record<string, { count: number; premium_usd: number; pnl_usd: number }>) => {
    const out: Record<string, { count: number; premium_usd: number; pnl_usd: number }> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = { count: v.count, premium_usd: round(v.premium_usd), pnl_usd: round(v.pnl_usd) };
    }
    return out;
  };

  const roundTicker = (obj: Record<string, { count: number; pnl_usd: number }>) => {
    const out: Record<string, { count: number; pnl_usd: number }> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = { count: v.count, pnl_usd: round(v.pnl_usd) };
    }
    return out;
  };

  const topTickers = Object.entries(byTicker)
    .sort(([, a], [, b]) => b.pnl_usd - a.pnl_usd)
    .slice(0, 10);

  return {
    local_root: root,
    since_days: args.since_days,
    sessions_found: filtered.length,
    trades_executed: executed.length,
    premium_collected_usd: round(totalPremium),
    realized_pnl_usd: round(totalRealizedPnl),
    win_rate: winRate === null ? null : round(winRate, 100),
    wins,
    losses,
    by_structure: roundStruct(byStructure),
    by_ticker: roundTicker(byTicker),
    by_regime: byRegime,
    top_tickers: topTickers.map(([ticker, stats]) => ({ ticker, ...stats, pnl_usd: round(stats.pnl_usd) })),
    narrative: [
      `Last ${args.since_days} days: ${filtered.length} session(s), ${executed.length} trade(s).`,
      `Premium collected: $${round(totalPremium).toLocaleString()}. Realized P&L: $${round(totalRealizedPnl).toLocaleString()}.`,
      winRate !== null
        ? `Win rate: ${round(winRate * 100, 10)}% (${wins}W · ${losses}L).`
        : `No closed P&L yet — all positions still open.`,
    ],
  };
}
