import type { ReactNode } from "react";
import { Link } from "react-router";

const NEXT_LINK =
  "flex min-h-12 items-center justify-center rounded-lg bg-spruce px-4.5 py-3.5 text-[15px] font-semibold text-white no-underline hover:bg-spruce-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";

/** The wide button at the foot of a step's side panel that goes on to the next step: "Next: describe the house →". */
export function NextStepLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={NEXT_LINK}>
      {children}
    </Link>
  );
}
