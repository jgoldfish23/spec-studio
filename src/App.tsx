import { Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createHashRouter, Navigate, useNavigate, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AppShell, DEALS_SECTION } from "./features/app/AppShell";
import { HostedShellContext } from "./features/app/hostedShell";
import type { HostedShell } from "./features/app/hostedShell";
import { NotFound } from "./features/app/NotFound";
import { Loading } from "./features/app/StartupScreens";
import { PersistentStorageContext } from "./features/app/storageMode";
import { DealRoute } from "./features/deal/DealRoute";
import { lazyStep } from "./features/deal/lazyStep";
import { StepPlaceholder } from "./features/deal/StepPlaceholder";
import { StepSkeleton } from "./features/deal/StepSkeleton";
import { STEPS, type StepId } from "./features/deal/steps";
import { DealsPage } from "./features/deals/DealsPage";

// Each step's screen is its own chunk, fetched when the step is first opened, so the first load is the frame, the
// Deals page and the engine, not all five screens.
const LotPage = lazyStep(() => import("./features/lot/LotPage").then(({ LotPage }) => ({ default: LotPage })));
const HousePage = lazyStep(() => import("./features/house/HousePage").then(({ HousePage }) => ({ default: HousePage })));
const EstimatePage = lazyStep(() =>
  import("./features/estimate/EstimatePage").then(({ EstimatePage }) => ({ default: EstimatePage })),
);
const MarketPage = lazyStep(() => import("./features/market/MarketPage").then(({ MarketPage }) => ({ default: MarketPage })));
const ProFormaPage = lazyStep(() =>
  import("./features/proforma/ProFormaPage").then(({ ProFormaPage }) => ({ default: ProFormaPage })),
);

/** The screen of each step that has one built; the others show a placeholder. A screen shows a skeleton while it loads. */
const STEP_SCREENS: Partial<Record<StepId, ReactNode>> = {
  lot: <LotPage />,
  house: <HousePage />,
  estimate: <EstimatePage />,
  market: <MarketPage />,
  proforma: <ProFormaPage />,
};

/** The shell, with the hosted build's header pieces when there are any. */
function Shell() {
  const hosted = useContext(HostedShellContext);
  return <AppShell account={hosted?.account} syncNote={hosted?.syncNote} />;
}

/**
 * `#/sign-in`, where a save that failed as signed out sends the owner. Demo mode has no one to sign in, so it goes to
 * the deals. Hosted, the device still holds a session the server no longer takes: this ends it, once, and the gate
 * then shows the sign-in page (and opens `#/deals` after it, so this route does not sign the owner out again). If the
 * session could not be ended, it goes on to the deals rather than wait here; if the server never answers, the wait
 * says so after a while and offers Try again.
 */
function SignInRoute() {
  const signOut = useContext(HostedShellContext)?.signOut;
  const navigate = useNavigate();
  const endSession = useCallback(() => {
    void signOut?.().then((ended) => {
      if (!ended) void navigate("/deals", { replace: true });
    });
  }, [signOut, navigate]);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    endSession();
  }, [endSession]);
  if (!signOut) return <Navigate to="/deals" replace />;
  return <Loading label="Signing out…" onRetry={endSession} />;
}

const routes: RouteObject[] = [
  // Outside the shell: in hosted mode it only ends the session.
  { path: "/sign-in", element: <SignInRoute /> },
  {
    path: "/",
    element: <Shell />,
    children: [
      // The list has one address; the root sends people to it.
      { index: true, element: <Navigate to="/deals" replace /> },
      { path: "deals", element: <DealsPage />, handle: DEALS_SECTION },
      {
        path: "deals/:dealId",
        handle: DEALS_SECTION,
        children: [
          { index: true, element: <Navigate to="lot" replace /> },
          {
            // One editor for the deal, shared by the frame and whichever step is open. Each later task adds its step's
            // screen to STEP_SCREENS.
            element: <DealRoute />,
            children: STEPS.map(({ path, title }) => ({
              path,
              element: <Suspense fallback={<StepSkeleton />}>{STEP_SCREENS[path] ?? <StepPlaceholder title={title} />}</Suspense>,
            })),
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export interface AppProps {
  /** False when the browser blocks storage and the data lives in memory only; the shell then says nothing is saved. */
  persistentStorage?: boolean;
  /** The hosted build's account menu, sync note and sign-out. Absent in demo mode, whose shell shows the demo pill. */
  hosted?: HostedShell;
}

export function App({ persistentStorage = true, hosted }: AppProps) {
  // Created per mount, not at module level, so each mount reads the current `#/...` location.
  const [router] = useState(() => createHashRouter(routes));
  return (
    <PersistentStorageContext.Provider value={persistentStorage}>
      <HostedShellContext.Provider value={hosted ?? null}>
        <RouterProvider router={router} />
      </HostedShellContext.Provider>
    </PersistentStorageContext.Provider>
  );
}
