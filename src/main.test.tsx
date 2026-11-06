import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRootProps } from "./HostedRoot";

// `main.tsx` starts the app as it is imported, into `#root`, so each test imports a fresh copy. Its root is never
// unmounted, so the demo test, whose router keeps listening to the address, runs last.

const BOTH_OR_NEITHER =
  "Spec Studio isn't configured correctly: set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or neither.";

/** Stands in for the hosted root, and records whether its module was ever loaded. */
const hosted = {
  loaded: false,
  props: undefined as HostedRootProps | undefined,
};

beforeEach(() => {
  vi.resetModules();
  hosted.loaded = false;
  hosted.props = undefined;
  vi.doMock("./HostedRoot", () => {
    hosted.loaded = true;
    return {
      HostedRoot: (props: HostedRootProps) => {
        hosted.props = props;
        return <p>Hosted app</p>;
      },
    };
  });
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, "", "/#/");
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./HostedRoot");
});

const start = () =>
  act(async () => {
    await import("./main");
  });

describe("main", () => {
  it.each([
    ["only the URL", "https://abcd1234.supabase.co", ""],
    ["only the key", "", "anon-key"],
  ])(
    "with %s, shows the configuration problem on a plain page and starts no app",
    async (_name, url, key) => {
      vi.stubEnv("VITE_SUPABASE_URL", url);
      vi.stubEnv("VITE_SUPABASE_ANON_KEY", key);
      await start();
      expect(screen.getByText(BOTH_OR_NEITHER)).toBeVisible();
      // No router: nothing sent the address on to #/deals.
      expect(window.location.hash).toBe("#/");
      expect(screen.queryByRole("banner")).not.toBeInTheDocument();
      expect(hosted.loaded).toBe(false);
    },
  );

  it("with both, loads the hosted app with the config and this browser's storage", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    await start();
    expect(await screen.findByText("Hosted app")).toBeVisible();
    expect(hosted.props).toMatchObject({
      config: {
        mode: "hosted",
        supabaseUrl: "https://abcd1234.supabase.co",
        supabaseAnonKey: "anon-key",
      },
      storage: localStorage,
      persistent: true,
    });
  });

  it("with neither, runs the demo, and never loads the hosted code", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    await start();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Deals" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("banner")).getByText(
        "Demo mode · saved in this browser",
      ),
    ).toBeVisible();
    expect(window.location.hash).toBe("#/deals");
    expect(hosted.loaded).toBe(false);
  });
});
