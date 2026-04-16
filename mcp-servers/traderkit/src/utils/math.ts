export function round(n: number, precision = 100): number {
  return Math.round(n * precision) / precision;
}
