const RESERVED = new Set(['new', 'id', 'api', 'export', 'generate']);

export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!base) return 'scheme';
  return RESERVED.has(base) ? `${base}-scheme` : base;
}

/** First free slug: base, base-2, base-3 … */
export function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  if (!taken(base)) return base;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique slug');
}
