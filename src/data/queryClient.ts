import { QueryClient } from "@tanstack/react-query";

/**
 * The app's one query client, built here so `main.tsx` and the tests share its settings. A failed read is a
 * `DataError` that retrying cannot fix, and refetching when the window regains focus would race the deal editor's
 * own copy of the deal, so both are off.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
}
