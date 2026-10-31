import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createLocalRepository } from "./data/local/localRepository";
import { createQueryClient } from "./data/queryClient";
import { RepositoryProvider } from "./data/RepositoryProvider";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Spec Studio could not start: index.html has no #root element.");

// Demo mode: everything is kept in this browser's localStorage and nothing goes over the network.
const queryClient = createQueryClient();
const repository = createLocalRepository(window.localStorage);

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider repository={repository}>
        <App />
      </RepositoryProvider>
    </QueryClientProvider>
  </StrictMode>,
);
