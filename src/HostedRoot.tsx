import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "./App";
import type { HostedConfig } from "./config";
import type { AuthGateway, AuthUser } from "./data/auth/authGateway";
import type { Company, CompanyGateway } from "./data/auth/companyGateway";
import {
  createOwnerMemory,
  rememberingOwner,
} from "./data/auth/rememberedOwner";
import type { OwnerMemory } from "./data/auth/rememberedOwner";
import { createSupabaseAuth } from "./data/auth/supabaseAuth";
import { createSupabaseCompany } from "./data/auth/supabaseCompany";
import { createOfflineRepository } from "./data/offline/offlineRepository";
import type { Refreshed } from "./data/offline/offlineRepository";
import { useOutboxSync } from "./data/offline/useOutboxSync";
import { queryKeys } from "./data/queries";
import { createQueryClient } from "./data/queryClient";
import { RepositoryProvider } from "./data/RepositoryProvider";
import { guardSession } from "./data/sessionGuard";
import { createSupabase } from "./data/supabase/client";
import { createSupabaseRepository } from "./data/supabase/supabaseRepository";
import { DataError } from "./data/types";
import type { Repository } from "./data/types";
import { SyncNote } from "./features/app/AppShell";
import { useOwnerCompany } from "./features/app/useOwnerCompany";
import type { HostedShell } from "./features/app/hostedShell";
import {
  Loading,
  StartupProblem,
  UNREACHABLE,
} from "./features/app/StartupScreens";
import { AccountMenu } from "./features/auth/AccountMenu";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { CreateCompanyPage } from "./features/auth/CreateCompanyPage";
import { handleLinkCallback } from "./features/auth/linkCallback";
import { SignInPage } from "./features/auth/SignInPage";
import type { SignInPageProps } from "./features/auth/SignInPage";
import { resetLostSaves } from "./features/deal/lostSaves";
import { FOCUS_RING } from "./features/deal/stepShared";

export interface HostedRootProps {
  config: HostedConfig;
  /** This browser's storage: the session, the offline outbox and the remembered owner are kept in it. */
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
 * One connection per config, storage and fetch. StrictMode runs a state initializer twice, and a second Supabase
 * client would run its own token refresh against the same stored session (supabase-js warns of "Multiple GoTrueClient
 * instances"). All three are part of the key: a client keeps its session in its storage, so the same config over
 * another storage must not get a client signed in with the first one's session.
 */
const connections = new WeakMap<
  HostedConfig,
  WeakMap<Storage, Map<typeof fetch | undefined, Connection>>
>();

function connectOnce(
  config: HostedConfig,
  storage: Storage,
  fetchOverride?: typeof fetch,
): Connection {
  let byStorage = connections.get(config);
  if (!byStorage) {
    byStorage = new WeakMap();
    connections.set(config, byStorage);
  }
  let byFetch = byStorage.get(storage);
  if (!byFetch) {
    byFetch = new Map();
    byStorage.set(storage, byFetch);
  }
  let connection = byFetch.get(fetchOverride);
  if (!connection) {
    connection = connect(config, storage, fetchOverride);
    byFetch.set(fetchOverride, connection);
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
 *
 * The device remembers who was last signed in and each owner's company, so a returning owner whose session or company
 * can't be read offline opens the app from the device; an owner with nothing remembered is told the server can't be
 * reached. `auth` and `storage` are fixed for the gate's life.
 */
export function HostedGate({
  auth: server,
  storage,
  ...rest
}: HostedGateProps) {
  // Made once: `auth` and `storage` are fixed for the gate's life, and the wrapper keeps state of its own.
  const [{ memory, auth }] = useState(() => {
    const remembered = createOwnerMemory(storage);
    return { memory: remembered, auth: rememberingOwner(server, remembered) };
  });
  const callback = useLinkCallback(auth);
  return (
    <AuthProvider auth={auth}>
      {callback === null ? (
        // A link's code exchange that never answers: reloading tries the link again.
        <Loading onRetry={() => window.location.reload()} />
      ) : (
        <Gate
          linkError={callback.error}
          memory={memory}
          storage={storage}
          {...rest}
        />
      )}
    </AuthProvider>
  );
}

type GateProps = Omit<HostedGateProps, "auth"> & {
  memory: OwnerMemory;
  linkError?: SignInPageProps["callbackError"];
};

function Gate({ linkError, ...rest }: GateProps) {
  const { status, user, auth, retry } = useAuth();
  // Why the link failed belongs on the first sign-in page, not on one after a later sign-out.
  const [callbackError, setCallbackError] = useState(linkError);
  if (status === "signedIn" && callbackError) setCallbackError(undefined);
  const generation = useSessionChanges(auth, user?.id);

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
  return (
    <OwnerSession
      key={`${user.id}:${generation}`}
      user={user}
      auth={auth}
      {...rest}
    />
  );
}

/**
 * Follows sign-ins and sign-outs as they are heard, before React renders them. Returns the session generation, which
 * every sign-out bumps: the owner's app is keyed on it, so a sign-out and the same owner's sign-in heard in one render
 * still remount the app with a fresh connection (the sign-out ended the old one). A different owner signing in than
 * the last one here starts on `#/deals`, not on the last owner's deep link, and does not see the last owner's
 * lost-save notices, which name their deals. The same owner keeps both.
 */
function useSessionChanges(
  auth: AuthGateway,
  userId: string | undefined,
): number {
  const [generation, setGeneration] = useState(0);
  const lastOwner = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (userId !== undefined) lastOwner.current = userId;
  }, [userId]);
  useEffect(
    () =>
      auth.onChange((next) => {
        if (next === null) {
          setGeneration((n) => n + 1);
          return;
        }
        if (lastOwner.current !== undefined && lastOwner.current !== next.id) {
          resetLostSaves();
          window.history.replaceState(null, "", "#/deals");
        }
        lastOwner.current = next.id;
      }),
    [auth],
  );
  return generation;
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

type OwnerProps = Omit<GateProps, "linkError"> & {
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
 * Everything one signed-in owner sees. It is keyed by the owner's id (and the session generation), so another owner
 * signing in gets a fresh query cache: nothing the last one loaded (deals, the company) can show, even for a moment,
 * and a save of theirs that lands late writes to a cache no one reads.
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
  const { user, auth, companies, memory } = props;
  const { company, retry, created } = useOwnerCompany({
    userId: user.id,
    companies,
    memory,
  });

  if (company.data === null) {
    return (
      <CreateCompanyPage
        companies={companies}
        auth={auth}
        onCreated={created}
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

/** The query a refreshed read answers. */
function refreshedKey(refreshed: Refreshed): QueryKey {
  switch (refreshed.read) {
    case "deals":
      return queryKeys.deals;
    case "deal":
      return queryKeys.deal(refreshed.id);
    case "comps":
      return queryKeys.comps(refreshed.region);
    case "costBook":
      return queryKeys.costBook(refreshed.region);
    case "marketSettings":
      return queryKeys.marketSettings(refreshed.region);
    case "companySettings":
      return queryKeys.companySettings;
  }
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
  // Made once for this session, in state rather than a memo (React may drop a memo, and these hold the outbox's
  // in-flight bookkeeping and the guard). The outbox is kept under the owner's id: another owner on this device never
  // sees or sends it.
  const [{ repository, end }] = useState(() => {
    const server = guardSession(makeRemote(company.id));
    return {
      repository: createOfflineRepository(server.remote, storage, user.id),
      end: server.end,
    };
  });
  // The session ending, however it ends, stops this owner's connection and copy before the app unmounts: the
  // editor's last save on the way out and any sync run still going wait in their outbox, and a late read adds nothing.
  const sessionEnded = useRef(false);
  useEffect(
    () =>
      auth.onChange((next) => {
        if (next?.id === user.id) return;
        sessionEnded.current = true;
        end();
        repository.stopDeviceCopy();
      }),
    [auth, user.id, end, repository],
  );
  // A screen opened from the device's copy (one bar, or no network) shows the server's answer when it comes. The answer
  // is put in place rather than read again: on a connection slower than the grace, a new read would be answered from
  // the copy again, and so on for ever.
  const queryClient = useQueryClient();
  useEffect(
    () =>
      repository.onRefreshed((refreshed) =>
        queryClient.setQueryData(refreshedKey(refreshed), refreshed.value),
      ),
    [repository, queryClient],
  );
  const { pendingCount } = useOutboxSync(repository);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const signOut = useCallback(async () => {
    setSignOutFailed(false);
    const ended = await endSession(auth);
    // When the session did end, this page has already gone; when it did not, the owner must hear it.
    if (!ended) setSignOutFailed(true);
    return ended;
  }, [auth]);
  // Leaving from the account menu also takes this owner's copy of reads off the device once the session has ended
  // (`#/sign-in`, signing in again, keeps it). The outbox stays: it holds work.
  const leave = useCallback(async () => {
    const ended = await signOut();
    if (ended || sessionEnded.current) repository.forgetDeviceCopy();
  }, [signOut, repository]);
  const hosted = useMemo<HostedShell>(
    () => ({
      account: (
        <AccountMenu
          user={user}
          pendingCount={pendingCount}
          onSignOut={() => void leave()}
        />
      ),
      syncNote: <SyncNote count={pendingCount} />,
      signOut,
    }),
    [user, pendingCount, signOut, leave],
  );
  return (
    <RepositoryProvider repository={repository}>
      {signOutFailed ? (
        <SignOutFailed onDismiss={() => setSignOutFailed(false)} />
      ) : null}
      <App persistentStorage={persistent} hosted={hosted} />
    </RepositoryProvider>
  );
}

/** A sign-out that did not happen: the owner is still signed in, and must not think otherwise. */
function SignOutFailed({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2C2BE] bg-no-go-bg px-4 py-2 text-sm font-medium text-no-go sm:px-8"
    >
      <p className="m-0 min-w-0 flex-1">
        Couldn't sign out — check your connection, then try again.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-no-go px-3.5 font-semibold hover:bg-surface ${FOCUS_RING}`}
      >
        Dismiss
      </button>
    </div>
  );
}
