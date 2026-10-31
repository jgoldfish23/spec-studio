import { createContext } from "react";

/**
 * Whether demo mode keeps the owner's data in this browser (true), or only in memory because the browser blocks
 * storage (false), in which case everything is gone when the page closes and the shell says so.
 */
export const PersistentStorageContext = createContext(true);
