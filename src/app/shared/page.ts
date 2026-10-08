/** Paginated result, as list endpoints return it (HU-014, HU-075). */
export interface Page<T> {
  items: T[];
  total: number;
  page: number; // 1-based
  pageSize: number;
}

export const PAGE_SIZE = 20;

export function paginate<T>(items: T[], page = 1, pageSize = PAGE_SIZE): Page<T> {
  const last = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), last);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    total: items.length,
    page: current,
    pageSize,
  };
}

/** Accent/case-insensitive "contains" for searches by name. */
export function matches(text: string, query: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  return norm(text).includes(norm(query.trim()));
}
