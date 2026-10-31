/** The message of a caught value, which JavaScript lets be anything. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
