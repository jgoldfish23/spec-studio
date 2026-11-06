import { StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigError, readAppConfig } from "./config";
import type { AppConfig, HostedConfig } from "./config";
import { openBrowserStorage } from "./data/local/browserStorage";
import { DemoRoot } from "./DemoRoot";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Spec Studio could not start: index.html has no #root element.");
const root = createRoot(container);
const show = (tree: ReactNode) => root.render(<StrictMode>{tree}</StrictMode>);

/** A page with one message and, when there is something to do, one button. Used before any app is running. */
function Plain({ message, busy = false, onRetry }: { message: string; busy?: boolean; onRetry?: () => void }) {
  return (
    <main aria-busy={busy} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper px-4 text-center text-ink">
      <p role={busy ? undefined : "alert"} className="m-0 max-w-[420px] text-[15px]">
        {message}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-spruce px-4.5 text-[15px] font-semibold text-white hover:bg-spruce-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce"
        >
          Try again
        </button>
      ) : null}
    </main>
  );
}

// Demo mode keeps everything here; hosted mode keeps the session and the offline outbox here. A browser that blocks
// storage gets storage in memory instead, and the shell says nothing is saved.
const { storage, persistent } = openBrowserStorage();

/** Hosted mode's code (Supabase included) is its own chunk, fetched only here: the demo build never runs it. */
function startHosted(config: HostedConfig) {
  show(<Plain message="Loading…" busy />);
  import("./HostedRoot").then(
    ({ HostedRoot }) => show(<HostedRoot config={config} storage={storage} persistent={persistent} />),
    (error: unknown) => {
      console.error("Spec Studio could not load:", error);
      show(
        <Plain
          message="Can't reach Spec Studio's server. Check your connection, then try again."
          onRetry={() => window.location.reload()}
        />,
      );
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

if (config instanceof ConfigError) show(<Plain message={config.message} />);
else if (config.mode === "demo") show(<DemoRoot storage={storage} persistent={persistent} />);
else startHosted(config);
