export type StatusPattern = number | string;

/**
 * Builds a predicate matching an HTTP status code against a list of patterns:
 * exact codes (`404`), class strings (`"4xx"`, `"5xx"`), and inclusive ranges
 * (`"400-599"`). Patterns are validated by the config schema before this runs.
 */
export function makeStatusMatch(patterns: StatusPattern[]): (code: number) => boolean {
  const exact = new Set<number>();
  const ranges: Array<[number, number]> = [];
  for (const p of patterns) {
    if (typeof p === 'number') {
      exact.add(p);
    } else if (/^[1-5]xx$/i.test(p)) {
      const base = Number(p[0]) * 100;
      ranges.push([base, base + 99]);
    } else if (/^\d{3}$/.test(p)) {
      exact.add(Number(p));
    } else {
      const [lo, hi] = p.split('-').map(Number);
      ranges.push([Math.min(lo, hi), Math.max(lo, hi)]);
    }
  }
  return (code) => exact.has(code) || ranges.some(([lo, hi]) => code >= lo && code <= hi);
}
