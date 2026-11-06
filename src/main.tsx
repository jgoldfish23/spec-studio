import { StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigError, readAppConfig } from "./config";
import type { AppConfig, HostedConfig } from "./config";
import { openBrowserStorage } from "./data/local/browserStorage";
import { DemoRoot } from "./DemoRoot";
import { Loading, StartupProblem, UNREACHABLE } from "./features/app/StartupScreens";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Spec Studio could not start: index.html has no #root element.");
const root = createRoot(container);
const show = (tree: ReactNode) => root.render(<StrictMode>{tree}</StrictMode>);

// Demo mode keeps everything here; hosted mode keeps the session, the offline outbox and the remembered owner here. A
// browser that blocks storage gets storage in memory instead, and the shell says nothing is saved.
const { storage, persistent } = openBrowserStorage();

/** Hosted mode's code (Supabase included) is its own chunk, fetched only here: the demo build never runs it. */
function startHosted(config: HostedConfig) {
  const reload = () => window.location.reload();
  show(<Loading onRetry={reload} />);
  import("./HostedRoot").then(
    ({ HostedRoot }) => show(<HostedRoot config={config} storage={storage} persistent={persistent} />),
    (error: unknown) => {
      console.error("Spec Studio could not load:", error);
      show(<StartupProblem title="Can't connect" message={UNREACHABLE} onAction={reload} />);
    },
  );
}

let config: AppConfig | ConfigError;
try {
  // Named one by one, so the build replaces each with its value and nothing else from the environment is bundled.
  config = readAppConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  });
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  config = error;
}

if (config instanceof ConfigError) show(<StartupProblem title="Can't start" message={config.message} />);
else if (config.mode === "demo") show(<DemoRoot storage={storage} persistent={persistent} />);
else startHosted(config);
