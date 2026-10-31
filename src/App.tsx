import { useState } from "react";
import { createHashRouter, Navigate, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AppShell } from "./features/app/AppShell";
import { NotFound } from "./features/app/NotFound";
import { DealsPage } from "./features/deals/DealsPage";

/** The five steps of a deal, in order. Each is a route under `/deals/:dealId/`. */
const STEPS = [
  { path: "lot", title: "Lot" },
  { path: "house", title: "House" },
  { path: "estimate", title: "Estimate" },
  { path: "market", title: "Market" },
  { path: "proforma", title: "Pro forma" },
] as const;

/** Stand-in until the step screens exist; each screen replaces its entry below. */
function StepPlaceholder({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-[30px] font-bold tracking-[-0.02em]">{title}</h1>
      <p className="text-muted">This step isn't built yet.</p>
    </section>
  );
}

const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DealsPage /> },
      {
        path: "deals/:dealId",
        children: [
          { index: true, element: <Navigate to="lot" replace /> },
          ...STEPS.map(({ path, title }) => ({ path, element: <StepPlaceholder title={title} /> })),
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
