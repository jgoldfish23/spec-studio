import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { App } from "./App";
import type { BrowserStorage } from "./data/local/browserStorage";
import { createLocalRepository } from "./data/local/localRepository";
import { createQueryClient } from "./data/queryClient";
import { RepositoryProvider } from "./data/RepositoryProvider";

/**
 * Demo mode: everything is kept in this browser's storage and nothing goes over the network. A browser that blocks
 * storage (a private window, a sandboxed frame) gets storage in memory instead, and the shell says nothing is saved.
 */
export function DemoRoot({ storage, persistent }: BrowserStorage) {
  const [queryClient] = useState(createQueryClient);
  const [repository] = useState(() => createLocalRepository(storage));
  return (
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider repository={repository}>
        <App persistentStorage={persistent} />
      </RepositoryProvider>
    </QueryClientProvider>
  );
}
