/**
 * An in-memory `Storage`, for tests: the same methods as `localStorage` with nothing written to disk. A test that
 * needs a full or blocked store extends it and overrides `setItem` or `getItem`.
 */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    // The real thing keeps text, so a number or an object is stored as its string form.
    this.items.set(key, String(value));
  }
}
