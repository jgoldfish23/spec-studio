import { useState, type ReactNode } from "react";
import { createHashRouter, Navigate, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AppShell, DEALS_SECTION } from "./features/app/AppShell";
import { NotFound } from "./features/app/NotFound";
import { DealRoute } from "./features/deal/DealRoute";
import { StepPlaceholder } from "./features/deal/StepPlaceholder";
import { STEPS, type StepId } from "./features/deal/steps";
import { DealsPage } from "./features/deals/DealsPage";
import { EstimatePage } from "./features/estimate/EstimatePage";
import { HousePage } from "./features/house/HousePage";
import { LotPage } from "./features/lot/LotPage";
import { MarketPage } from "./features/market/MarketPage";

/** The screen of each step that has one built; the others show a placeholder. */
const STEP_SCREENS: Partial<Record<StepId, ReactNode>> = {
  lot: <LotPage />,
  house: <HousePage />,
  estimate: <EstimatePage />,
  market: <MarketPage />,
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
            children: STEPS.map(({ path, title }) => ({ path, element: STEP_SCREENS[path] ?? <StepPlaceholder title={title} /> })),
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
