/**
 * Search result filters, kept in the URL as a comma list: "open" (open now), "access"
 * (wheelchair accessible), "near" (sort by distance), "auto" (search again as the map
 * moves) and "c-<cuisine>" (one cuisine, OSM value).
 */
export function parseFilters(f: string | undefined): Set<string> {
  return new Set((f ?? '').split(',').filter(Boolean));
}

export function toggleFilter(f: string | undefined, token: string): string | undefined {
  const s = parseFilters(f);
  if (s.has(token)) s.delete(token);
  else {
    // One cuisine at a time.
    if (token.startsWith('c-')) for (const t of s) if (t.startsWith('c-')) s.delete(t);
    s.add(token);
  }
  return s.size ? [...s].join(',') : undefined;
}

/** "pizza;italian" -> ["pizza", "italian"]; only values that fit the URL filter syntax. */
export function cuisinesOf(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[a-z_]{2,30}$/.test(c));
}

/** The cuisines most results share, for the filter chips (at most `n`, each on 2+ places). */
export function topCuisines(values: (string | undefined)[], n = 5): string[] {
  const count = new Map<string, number>();
  for (const v of values) for (const c of cuisinesOf(v)) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.entries()]
    .filter(([, k]) => k >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c);
}
