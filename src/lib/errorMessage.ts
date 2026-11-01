/** The message of a caught value, which JavaScript lets be anything. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A save failure's message without the "Couldn't save —" it usually starts with. The repositories write their
 * reasons that way, so a screen that already says "Couldn't save" would say it twice. Empty if nothing else is left.
 */
export function withoutSavePrefix(message: string): string {
  return message.replace(/^Couldn[’']t save(?:\s*[—–-]\s*|\s*$)/, "").trim();
}
