import type { PostgrestError } from "@supabase/supabase-js";

/** PostgREST returns at most this many rows per request by default (`max-rows`), so a longer list comes in pages. */
export const PAGE_SIZE = 1000;

/** What a PostgREST query resolves to: rows or an error, and the HTTP status. */
export interface PageResult<T> {
  data: T[] | null;
  error: PostgrestError | null;
  status: number;
}

/**
 * Reads every row of a query, one page at a time: `query(0, 999)`, then `query(1000, 1999)`, and so on, stopping at the
 * first page shorter than `pageSize`. Each query must have a stable `.order(...)` or pages could repeat or skip rows.
 * Returns the first failing page as it came, or all the rows.
 */
export async function fetchAllPages<T>(
  query: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await query(from, from + pageSize - 1);
    if (page.error) return page;
    const got = page.data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return { data: rows, error: null, status: page.status };
  }
}
