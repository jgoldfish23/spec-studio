import { Suspense, useState, type ReactNode } from "react";
import { createHashRouter, Navigate, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AppShell, DEALS_SECTION } from "./features/app/AppShell";
import { NotFound } from "./features/app/NotFound";
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

const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
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

export function App() {
  // Created per mount, not at module level, so each mount reads the current `#/...` location.
  const [router] = useState(() => createHashRouter(routes));
  return <RouterProvider router={router} />;
}
