import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "./App";
import type { HostedConfig } from "./config";
import type { AuthGateway, AuthUser } from "./data/auth/authGateway";
import type { Company, CompanyGateway } from "./data/auth/companyGateway";
import { createSupabaseAuth } from "./data/auth/supabaseAuth";
import { createSupabaseCompany } from "./data/auth/supabaseCompany";
import { createOfflineRepository } from "./data/offline/offlineRepository";
import { useOutboxSync } from "./data/offline/useOutboxSync";
import { createQueryClient } from "./data/queryClient";
import { RepositoryProvider } from "./data/RepositoryProvider";
import { createSupabase } from "./data/supabase/client";
import { createSupabaseRepository } from "./data/supabase/supabaseRepository";
import { DataError } from "./data/types";
import type { Repository } from "./data/types";
import { SyncNote } from "./features/app/AppShell";
import type { HostedShell } from "./features/app/hostedShell";
import { AccountMenu } from "./features/auth/AccountMenu";
import { AuthFrame } from "./features/auth/AuthFrame";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { CreateCompanyPage } from "./features/auth/CreateCompanyPage";
import { handleLinkCallback } from "./features/auth/linkCallback";
import { SignInPage } from "./features/auth/SignInPage";
import type { SignInPageProps } from "./features/auth/SignInPage";
import { resetLostSaves } from "./features/deal/lostSaves";
import { PRIMARY_BUTTON } from "./features/deal/stepShared";

/** What the owner sees when the server can't be reached while the app starts. */
export const UNREACHABLE =
  "Can't reach Spec Studio's server. Check your connection, then try again.";

/** How long the start waits on the server before saying it can't reach it. The request keeps going meanwhile. */
export const STARTUP_PATIENCE_MS = 15_000;

export interface HostedRootProps {
  config: HostedConfig;
  /** This browser's storage: the session and the offline outbox are kept in it. */
  storage: Storage;
  /** False when the browser blocks storage and `storage` is in memory only. */
  persistent: boolean;
  /** Tests only: replaces the Supabase client's `fetch`. */
  fetchOverride?: typeof fetch;
}

/** What the gate needs from the server: sign-in, the owner's company, and each company's data. */
interface Connection {
  auth: AuthGateway;
  companies: CompanyGateway;
  makeRemote: (companyId: string) => Repository;
}

function connect(
  config: HostedConfig,
  storage: Storage,
  fetchOverride?: typeof fetch,
): Connection {
  const client = createSupabase(
    { url: config.supabaseUrl, anonKey: config.supabaseAnonKey },
    storage,
    fetchOverride,
  );
  return {
    auth: createSupabaseAuth(client),
    companies: createSupabaseCompany(client),
    makeRemote: (companyId) => createSupabaseRepository(client, companyId),
  };
}

/**
 * One connection per config. StrictMode runs a state initializer twice, and a second Supabase client would run its own
 * token refresh against the same stored session (supabase-js warns of "Multiple GoTrueClient instances").
 */
const connections = new WeakMap<HostedConfig, Connection>();

function connectOnce(
  config: HostedConfig,
  storage: Storage,
  fetchOverride?: typeof fetch,
): Connection {
  let connection = connections.get(config);
  if (!connection) {
    connection = connect(config, storage, fetchOverride);
    connections.set(config, connection);
  }
  return connection;
}

/** The hosted build: one Supabase client for the page's life, and the gate in front of the app. */
export function HostedRoot({
  config,
  storage,
  persistent,
  fetchOverride,
}: HostedRootProps) {
  const [{ auth, companies, makeRemote }] = useState(() =>
    connectOnce(config, storage, fetchOverride),
  );
  return (
    <HostedGate
      auth={auth}
      companies={companies}
      makeRemote={makeRemote}
      storage={storage}
      persistent={persistent}
    />
  );
}

export interface HostedGateProps {
  auth: AuthGateway;
  companies: CompanyGateway;
  /** The server's data for one company. */
  makeRemote: (companyId: string) => Repository;
  storage: Storage;
  persistent: boolean;
}

type LinkResult = Awaited<ReturnType<typeof handleLinkCallback>>;

/** Finishes a sign-in link (`?code=`) once per page, even though StrictMode runs effects twice: a code works once. */
function useLinkCallback(auth: AuthGateway): LinkResult | null {
  const [result, setResult] = useState<LinkResult | null>(null);
  const started = useRef<{
    auth: AuthGateway;
    run: Promise<LinkResult>;
  } | null>(null);
  useEffect(() => {
    let live = true;
    if (started.current?.auth !== auth) {
      started.current = {
        auth,
        run: handleLinkCallback(window.location, auth),
      };
    }
    void started.current.run.then((done) => {
      if (live) setResult(done);
    });
    return () => {
      live = false;
    };
  }, [auth]);
  return result;
}

/**
 * The hosted app's front door. It finishes a sign-in link if the page was opened from one, then shows, in order: the
 * sign-in page while no one is signed in, the company setup while the owner has none, and the app. The app reads the
 * company's data through an outbox kept on this device under the owner's id, so edits made offline, or after the
 * session ended, wait for that same owner.
 */
export function HostedGate({ auth, ...rest }: HostedGateProps) {
  const callback = useLinkCallback(auth);
  return (
    <AuthProvider auth={auth}>
      {callback === null ? (
        // A link's code exchange that never answers: reloading tries the link again.
        <Loading onRetry={() => window.location.reload()} />
      ) : (
        <Gate linkError={callback.error} {...rest} />
      )}
    </AuthProvider>
  );
}

function Gate({
  linkError,
  ...rest
}: Omit<HostedGateProps, "auth"> & {
  linkError?: SignInPageProps["callbackError"];
}) {
  const { status, user, auth, retry } = useAuth();
  // Why the link failed belongs on the first sign-in page, not on one after a later sign-out.
  const [callbackError, setCallbackError] = useState(linkError);
  if (status === "signedIn" && callbackError) setCallbackError(undefined);
  useForgetPreviousOwner(user?.id);

  if (status === "loading") return <Loading onRetry={retry} />;
  if (status === "unreachable")
    return (
      <StartupProblem
        title="Can't connect"
        message={UNREACHABLE}
        onAction={retry}
      />
    );
  if (status === "signedOut" || !user)
    return <SignInScreen auth={auth} callbackError={callbackError} />;
  return <OwnerSession key={user.id} user={user} auth={auth} {...rest} />;
}

/**
 * A different owner signing in on this device must not see the last one's lost-save notices, which name that owner's
 * deals. The same owner signing back in keeps them.
 */
function useForgetPreviousOwner(userId: string | undefined) {
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (userId === undefined) return;
    if (previous.current !== undefined && previous.current !== userId)
      resetLostSaves();
    previous.current = userId;
  }, [userId]);
}

/** `#/sign-in` (and anything under it) signs a signed-in owner out. */
const SIGN_IN_ROUTE = /^#\/sign-in\/?(?:[?#]|$)/;

/**
 * The sign-in page. The app must not open on `#/sign-in` once the owner is in, or that route would sign them out
 * again, so while this page is up the address becomes `#/deals` (replaced, so Back does not return to it). Any other
 * address is kept: the owner comes back to where the session ended.
 */
function SignInScreen(props: SignInPageProps) {
  useEffect(() => {
    if (SIGN_IN_ROUTE.test(window.location.hash))
      window.history.replaceState(null, "", "#/deals");
  }, []);
  return <SignInPage {...props} />;
}

type OwnerProps = Omit<HostedGateProps, "auth"> & {
  user: AuthUser;
  auth: AuthGateway;
};

/** A query client for one owner's session. */
function createSessionQueryClient() {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  // The repository decides what offline means (the outbox answers, or the error says so), so requests always run
  // rather than pausing until the browser reports a network.
  client.setDefaultOptions({
    queries: { ...defaults.queries, networkMode: "always" },
    mutations: { ...defaults.mutations, networkMode: "always" },
  });
  return client;
}

/**
 * Everything one signed-in owner sees. It is keyed by the owner's id, so another owner signing in gets a fresh query
 * cache: nothing the last one loaded (deals, the company) can show, even for a moment, and a save of theirs that
 * lands late writes to a cache no one reads.
 */
function OwnerSession(props: OwnerProps) {
  const [queryClient] = useState(createSessionQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <CompanyGate {...props} />
    </QueryClientProvider>
  );
}

function CompanyGate(props: OwnerProps) {
  const { user, auth, companies } = props;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["company", user.id] as const, [user.id]);
  const company = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await companies.myCompany();
      } catch (error) {
        if (!(error instanceof DataError))
          console.error("Couldn't load the company:", error);
        throw error;
      }
    },
    staleTime: Infinity,
  });
  const { refetch } = company;
  const retry = useCallback(() => {
    // A first read that never answered is still "fetching", and a refetch would only wait on it: drop it first.
    void queryClient.cancelQueries({ queryKey }).then(() => refetch());
  }, [queryClient, queryKey, refetch]);

  if (company.data === null) {
    return (
      <CreateCompanyPage
        companies={companies}
        auth={auth}
        onCreated={(created) => queryClient.setQueryData(queryKey, created)}
      />
    );
  }
  if (company.data)
    return (
      <SignedInApp key={company.data.id} company={company.data} {...props} />
    );
  if (company.isFetching || !company.isError)
    return <Loading onRetry={retry} />;

  const error = company.error;
  if (error instanceof DataError && error.kind === "signedOut") {
    return (
      <StartupProblem
        title="Signed out"
        message="You've been signed out. Sign in again."
        action="Sign in"
        onAction={() => void endSession(auth)}
      />
    );
  }
  if (error instanceof DataError && error.kind === "offline") {
    return (
      <StartupProblem
        title="Can't connect"
        message={UNREACHABLE}
        onAction={retry}
      />
    );
  }
  return (
    <StartupProblem
      title="Couldn't start"
      message={
        error instanceof DataError
          ? error.message
          : "Couldn't load your company — try again in a minute."
      }
      onAction={retry}
    />
  );
}

/** Signs out; false when that failed, which is reported here. */
async function endSession(auth: AuthGateway): Promise<boolean> {
  try {
    await auth.signOut();
    return true;
  } catch (error) {
    console.error("Couldn't sign out:", error);
    return false;
  }
}

const SESSION_ENDED = "You've been signed out.";

/**
 * `remote` until `close()`; after it, every call fails as signed out (the outbox then keeps what it was sending). A
 * request goes out under whatever session the client holds when it is sent, so without this a sync run still going
 * when its owner signs out would send their next edit under no session, or under the next owner's, whose company's
 * rules then make it look deleted.
 */
function closable(remote: Repository): {
  remote: Repository;
  close: () => void;
} {
  let open = true;
  const guarded: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(remote) as [
    string,
    (...args: unknown[]) => Promise<unknown>,
  ][]) {
    guarded[name] = (...args: unknown[]) =>
      open
        ? method(...args)
        : Promise.reject(new DataError(SESSION_ENDED, { kind: "signedOut" }));
  }
  return {
    remote: guarded as unknown as Repository,
    close: () => {
      open = false;
    },
  };
}

/** The app for one owner and company: their outbox in front of the company's data, kept syncing. */
function SignedInApp({
  user,
  company,
  auth,
  makeRemote,
  storage,
  persistent,
}: OwnerProps & { company: Company }) {
  // The outbox is kept under the owner's id: another owner on this device never sees or sends it.
  const { repository, close } = useMemo(() => {
    const server = closable(makeRemote(company.id));
    return {
      repository: createOfflineRepository(server.remote, storage, user.id),
      close: server.close,
    };
  }, [makeRemote, company.id, storage, user.id]);
  // Closed by the sign-out itself, before the app unmounts: the editor's last save on the way out, and any sync run
  // still going, then wait in this owner's outbox for them.
  useEffect(
    () =>
      auth.onChange((next) => {
        if (next?.id !== user.id) close();
      }),
    [auth, user.id, close],
  );
  const { pendingCount } = useOutboxSync(repository);
  const signOut = useCallback(() => endSession(auth), [auth]);
  const hosted = useMemo<HostedShell>(
    () => ({
      account: (
        <AccountMenu
          user={user}
          pendingCount={pendingCount}
          onSignOut={() => void signOut()}
        />
      ),
      syncNote: <SyncNote count={pendingCount} />,
      signOut,
    }),
    [user, pendingCount, signOut],
  );
  return (
    <RepositoryProvider repository={repository}>
      <App persistentStorage={persistent} hosted={hosted} />
    </RepositoryProvider>
  );
}

/**
 * While the start waits on the server. If it waits longer than `STARTUP_PATIENCE_MS`, it says it can't reach the
 * server and offers Try again, so a request that never answers is never an endless spinner.
 */
function Loading({ onRetry }: { onRetry: () => void }) {
  const [round, setRound] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STARTUP_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [round]);
  if (slow) {
    return (
      <StartupProblem
        title="Can't connect"
        message={UNREACHABLE}
        onAction={() => {
          setSlow(false);
          setRound((n) => n + 1);
          onRetry();
        }}
      />
    );
  }
  return (
    <main
      aria-busy="true"
      className="flex min-h-dvh items-center justify-center bg-paper px-4 text-ink"
    >
      <p className="m-0 text-[15px] text-muted">Loading…</p>
    </main>
  );
}

/** A start that cannot go on: what happened, in the owner's words, and the one thing to do about it. */
function StartupProblem({
  title,
  message,
  action = "Try again",
  onAction,
}: {
  title: string;
  message: string;
  action?: string;
  onAction: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <AuthFrame title={title}>
      <div className="flex flex-col gap-4">
        <p role="alert" className="m-0 text-[15px] wrap-break-word">
          {message}
        </p>
        <button
          ref={button}
          type="button"
          onClick={onAction}
          className={PRIMARY_BUTTON}
        >
          {action}
        </button>
      </div>
    </AuthFrame>
  );
}
