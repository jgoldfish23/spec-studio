import { useState } from "react";
import { createHashRouter, Navigate, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AppShell, DEALS_SECTION } from "./features/app/AppShell";
import { NotFound } from "./features/app/NotFound";
import { DealRoute } from "./features/deal/DealRoute";
import { StepPlaceholder } from "./features/deal/StepPlaceholder";
import { STEPS } from "./features/deal/steps";
import { DealsPage } from "./features/deals/DealsPage";

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
            // One editor for the deal, shared by the frame and whichever step is open. Each later task replaces one
            // step's element below with its screen.
            element: <DealRoute />,
            children: STEPS.map(({ path, title }) => ({ path, element: <StepPlaceholder title={title} /> })),
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
