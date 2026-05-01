import { z } from "zod";
import { TickerSchema } from "../utils/schemas.js";
import {
  uwDarkpoolFlow,
  uwFlowAlerts,
  type UWDarkpoolTrade,
  type UWFlowAlert,
} from "../clients/uw-client.js";
import {
  isTradingDay,
  getLastNTradingDays,
  getTradingDayProgress,
  toIsoDate,
} from "../utils/calendar.js";
import {
  analyzeDarkpool,
  analyzeOptionsFlow,
  interpolateIntradayFlow,
  combineSignal,
  aggregateDailySignals,
  type DailyDarkpoolSignal,
  type DarkpoolAggregate,
  type IntradayInterpolation,
} from "../utils/flow.js";

export const FetchFlowArgs = z.object({
  ticker: TickerSchema,
  lookback_days: z.number().int().positive().max(30).default(5),
  skip_options_flow: z.boolean().default(false),
  min_alert_premium: z.number().int().nonnegative().default(50000),
});

export type FetchFlowInput = z.input<typeof FetchFlowArgs>;

export interface FetchFlowResult {
  ticker: string;
  fetched_at: string;
  lookback_trading_days: number;
  trading_days_checked: string[];
  market_status: string;
  trading_day_progress: number;
  is_market_hours: boolean;
  dark_pool: {
    aggregate_actual: DarkpoolAggregate;
    aggregate: DarkpoolAggregate;
    aggregate_interpolated?: DarkpoolAggregate;
    daily: DailyDarkpoolSignal[];
  };
  options_flow: ReturnType<typeof analyzeOptionsFlow>;
  combined_signal: ReturnType<typeof combineSignal>;
  intraday_interpolation?: IntradayInterpolation;
}

interface FetchFlowDeps {
  fetchDarkpool?: (ticker: string, date: string) => Promise<UWDarkpoolTrade[]>;
  fetchAlerts?: (ticker: string, minPremium: number) => Promise<UWFlowAlert[]>;
  now?: () => Date;
}

export async function fetchFlowHandler(raw: unknown, deps: FetchFlowDeps = {}): Promise<FetchFlowResult> {
  const args = FetchFlowArgs.parse(raw);
  const ticker = args.ticker;
  const now = deps.now ? deps.now() : new Date();

  const fetchDp = deps.fetchDarkpool ?? ((t, d) => uwDarkpoolFlow(t, { date: d }));
  const fetchAlerts = deps.fetchAlerts
    ?? ((t, mp) => uwFlowAlerts({ ticker: t, minPremium: mp, limit: 100 }));

  const tradingDays = getLastNTradingDays(args.lookback_days, now);
  const todayStr = toIsoDate(now);
  if (isTradingDay(now) && !tradingDays.includes(todayStr)) {
    tradingDays.unshift(todayStr);
  }

  const progress = getTradingDayProgress(now);

  const dailyResults = await Promise.all(
    tradingDays.map(async (date): Promise<DailyDarkpoolSignal> => {
      const trades = await fetchDp(ticker, date);
      const sig = analyzeDarkpool(trades);
      return { ...sig, date };
    }),
  );

  const alerts = args.skip_options_flow ? [] : await fetchAlerts(ticker, args.min_alert_premium);

  const optionsFlow = analyzeOptionsFlow(alerts);
  const aggregateActual = aggregateDailySignals(dailyResults);

  let interpolation: IntradayInterpolation | undefined;
  let aggregateInterpolated: DarkpoolAggregate | undefined;
  const daily: DailyDarkpoolSignal[] = dailyResults.map((d) => ({ ...d }));

  if (daily.length > 0 && daily[0]!.date === todayStr) {
    const todayData = daily[0]!;
    const priorAggs: DarkpoolAggregate[] = daily.slice(1);
    interpolation = interpolateIntradayFlow(todayData, priorAggs, progress.progress);
    daily[0] = {
      ...todayData,
      is_partial: progress.progress < 1.0,
      trading_day_progress: progress.progress,
    };

    if (interpolation.is_interpolated) {
      const it = interpolation.interpolated;
      let total_volume = it.total_volume;
      let total_premium = it.total_premium;
      let buy_volume = it.buy_volume;
      let sell_volume = it.sell_volume;
      let num_prints = it.num_prints;
      for (const d of priorAggs) {
        total_volume += d.total_volume;
        total_premium += d.total_premium;
        buy_volume += d.buy_volume;
        sell_volume += d.sell_volume;
        num_prints += d.num_prints;
      }
      const classified = buy_volume + sell_volume;
      const ratio = classified > 0 ? Math.round((buy_volume / classified) * 10000) / 10000 : null;
      let direction: DarkpoolAggregate["flow_direction"];
      let strength: number;
      if (ratio === null) { direction = "UNKNOWN"; strength = 0; }
      else if (ratio >= 0.55) { direction = "ACCUMULATION"; strength = Math.round((ratio - 0.5) * 200 * 10) / 10; }
      else if (ratio <= 0.45) { direction = "DISTRIBUTION"; strength = Math.round((0.5 - ratio) * 200 * 10) / 10; }
      else { direction = "NEUTRAL"; strength = 0; }

      aggregateInterpolated = {
        total_volume,
        total_premium: Math.round(total_premium * 100) / 100,
        buy_volume,
        sell_volume,
        dp_buy_ratio: ratio,
        flow_direction: direction,
        flow_strength: strength,
        num_prints,
      };
    }
  }

  const effectiveAggregate = aggregateInterpolated ?? aggregateActual;
  const combined = combineSignal(effectiveAggregate.flow_direction, optionsFlow.bias);

  const result: FetchFlowResult = {
    ticker,
    fetched_at: now.toISOString(),
    lookback_trading_days: args.lookback_days,
    trading_days_checked: tradingDays,
    market_status: progress.status,
    trading_day_progress: progress.progress,
    is_market_hours: progress.is_market_hours,
    dark_pool: {
      aggregate_actual: aggregateActual,
      aggregate: effectiveAggregate,
      daily,
      ...(aggregateInterpolated ? { aggregate_interpolated: aggregateInterpolated } : {}),
    },
    options_flow: optionsFlow,
    combined_signal: combined,
    ...(interpolation ? { intraday_interpolation: interpolation } : {}),
  };

  return result;
}
