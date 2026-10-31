import { MemoryStorage } from "./memoryStorage";

/** What demo mode keeps its data in, and whether that survives a reload. */
export interface BrowserStorage {
  storage: Storage;
  /** False when the browser blocks storage and the data lives in memory only, gone when the page closes. */
  persistent: boolean;
}

/** The key written and removed to find out whether the browser takes writes. */
export const PROBE_KEY = "spec-studio:probe";

/** True when the store holds anything. A store that cannot even be counted holds nothing usable. */
function holdsData(storage: Storage): boolean {
  try {
    return storage.length > 0;
  } catch {
    return false;
  }
}

/**
 * The browser's `localStorage`, or storage in memory when the browser blocks it. Reading `window.localStorage` throws
 * in some private windows and in sandboxed or third-party frames (where the demo is published), and some browsers hand
 * out a store that refuses every write; either way the app must still start, so it falls back to `MemoryStorage` and
 * says the data is not kept (`persistent: false`). A store that already holds data but refuses the test write is full,
 * not blocked: it is kept, so the deals in it still load (and a save that fails says so where it fails).
 */
export function openBrowserStorage(access: () => Storage = () => window.localStorage): BrowserStorage {
  const fallback = (): BrowserStorage => ({ storage: new MemoryStorage(), persistent: false });
  let storage: Storage;
  try {
    storage = access();
  } catch {
    return fallback();
  }
  try {
    storage.setItem(PROBE_KEY, PROBE_KEY);
    storage.removeItem(PROBE_KEY);
    return { storage, persistent: true };
  } catch {
    return storage !== null && storage !== undefined && holdsData(storage) ? { storage, persistent: true } : fallback();
  }
}
