/** What the fake answers: an HTTP status, a JSON body (none for a 204), and any headers of its own. */
export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
