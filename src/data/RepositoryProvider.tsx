import { createContext } from "react";
import type { ReactNode } from "react";
import type { Repository } from "./types";

/** Where the screens get their `Repository`. Read it through `useRepository`, which says so when there is none. */
export const RepositoryContext = createContext<Repository | null>(null);

export function RepositoryProvider({ repository, children }: { repository: Repository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}
