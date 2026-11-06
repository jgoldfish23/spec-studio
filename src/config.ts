/** The hosted build: the app keeps its data in this Supabase project. */
export type HostedConfig = {
  mode: "hosted";
  supabaseUrl: string;
  supabaseAnonKey: string;
};

/** How this build runs: in the browser alone (demo), or against a Supabase project (hosted). */
export type AppConfig = { mode: "demo" } | HostedConfig;

/** A build whose settings cannot work. The message is shown on the page, so it names what to fix and never the key. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const BOTH_OR_NEITHER =
  "Spec Studio isn't configured correctly: set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or neither.";
const NOT_AN_ADDRESS =
  "Spec Studio isn't configured correctly: VITE_SUPABASE_URL isn't a web address.";

/** Hosts a plain `http://` project address may name: a Supabase on this machine. Any `*.test` host is allowed too. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/** Whether `url` is safe to send the session to: https, or plain http to this machine or a test double. */
function acceptable(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".test"))
  );
}

/**
 * Reads the build's settings. Neither variable is demo mode; both are hosted mode. An empty value counts as unset, as
 * a build given an empty repository variable gets one. Exactly one set, or an address that is not https (other than
 * `http://localhost`, `http://127.0.0.1` and `http://<name>.test`, for development and the e2e tests), is a
 * `ConfigError`.
 */
export function readAppConfig(
  env: Record<string, string | undefined>,
): AppConfig {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? "";
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  if (supabaseUrl === "" && supabaseAnonKey === "") return { mode: "demo" };
  if (supabaseUrl === "" || supabaseAnonKey === "") {
    throw new ConfigError(BOTH_OR_NEITHER);
  }
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new ConfigError(NOT_AN_ADDRESS);
  }
  if (!acceptable(url)) {
    // Only the scheme and host: a path or query could hold something that should not be shown.
    throw new ConfigError(
      `Spec Studio isn't configured correctly: VITE_SUPABASE_URL must be an https:// address, not ${url.protocol}//${url.host}.`,
    );
  }
  return { mode: "hosted", supabaseUrl, supabaseAnonKey };
}
